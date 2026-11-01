/**
 * MUDRA service lifecycle manager.
 *
 * Services are started as direct Node children (not npm.cmd wrappers), making
 * every process owned by this manager directly trackable on Windows.
 */
const fs = require("node:fs");
const fsp = fs.promises;
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PORTS = [
  { name: "UDP ingestion", port: 5005, protocol: "udp" },
  { name: "Module 4 HTTP", port: 3000, protocol: "tcp" },
  { name: "Module 3 WebSocket", port: 8080, protocol: "tcp" },
  { name: "Vite frontend", port: 5173, protocol: "tcp" }
];
const ROOT_HASH = crypto.createHash("sha256").update(ROOT.toLowerCase()).digest("hex").slice(0, 20);
const RUNTIME_BASE = process.env.MUDRA_RUNTIME_DIR || path.join(os.tmpdir(), "mudra-runtime");
const LOCK_DIRECTORY = path.join(RUNTIME_BASE, `${ROOT_HASH}.lock`);
const CONTROL_ADDRESS = process.platform === "win32"
  ? `\\\\.\\pipe\\mudra-${ROOT_HASH}`
  : path.join(RUNTIME_BASE, `mudra-${ROOT_HASH}.sock`);
const STARTUP_TIMEOUT_MS = 30000;
const SHUTDOWN_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function readOwner(lockDirectory = LOCK_DIRECTORY) {
  try {
    return JSON.parse(await fsp.readFile(path.join(lockDirectory, "owner.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function acquireInstanceLock(lockDirectory, owner) {
  await fsp.mkdir(path.dirname(lockDirectory), { recursive: true });
  const recoveryDirectory = `${lockDirectory}.recovery`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fsp.mkdir(lockDirectory);
      try {
        await fsp.writeFile(
          path.join(lockDirectory, "owner.json"),
          JSON.stringify(owner),
          { flag: "wx" }
        );
        return { acquired: true, owner };
      } catch (error) {
        await fsp.rmdir(lockDirectory).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    let existing;
    try {
      existing = await readOwner(lockDirectory);
    } catch (error) {
      throw new Error(`Could not read the MUDRA instance lock: ${error.message}`);
    }
    if (existing && isProcessAlive(existing.pid)) {
      return { acquired: false, owner: existing };
    }

    let recoveryHeld = false;
    try {
      await fsp.mkdir(recoveryDirectory);
      recoveryHeld = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await sleep(50);
      continue;
    }

    try {
      const current = await readOwner(lockDirectory);
      const canReclaim = current
        ? !isProcessAlive(current.pid)
        : await fsp.stat(lockDirectory)
          .then(stats => Date.now() - stats.mtimeMs > 30000)
          .catch(() => false);
      if (canReclaim) {
        const stalePath = `${lockDirectory}.stale-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
        try {
          await fsp.rename(lockDirectory, stalePath);
          await fsp.rm(stalePath, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
        }
      }
    } finally {
      if (recoveryHeld) await fsp.rmdir(recoveryDirectory).catch(() => {});
    }
  }

  const existing = await readOwner(lockDirectory);
  return { acquired: false, owner: existing };
}

async function releaseInstanceLock(lockDirectory, lockToken) {
  const owner = await readOwner(lockDirectory);
  if (!owner || owner.lockToken !== lockToken) return false;
  await fsp.unlink(path.join(lockDirectory, "owner.json")).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  await fsp.rmdir(lockDirectory).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  return true;
}

function getPortOwners() {
  if (process.platform !== "win32") {
    return [];
  }

  const command = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "$ports = @(5005,3000,8080,5173); $items = @();",
    "foreach ($port in $ports) {",
    "  if ($port -eq 5005) { $endpoints = @(Get-NetUDPEndpoint -LocalPort $port) }",
    "  else { $endpoints = @(Get-NetTCPConnection -LocalPort $port -State Listen) }",
    "  foreach ($endpoint in $endpoints) {",
    "    $proc = Get-CimInstance Win32_Process -Filter \"ProcessId = $($endpoint.OwningProcess)\";",
    "    if ($proc) {",
    "      $items += [pscustomobject]@{",
    "        port = $port; protocol = $(if ($port -eq 5005) {'udp'} else {'tcp'});",
    "        address = $endpoint.LocalAddress; pid = [int]$proc.ProcessId;",
    "        process = $proc.Name; commandLine = $proc.CommandLine",
    "      }",
    "    }",
    "  }",
    "}; ConvertTo-Json -InputObject @($items) -Compress -Depth 3"
  ].join(" ");

  try {
    const output = execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command", command
    ], { encoding: "utf8", timeout: 10000, windowsHide: true }).trim();
    return output ? JSON.parse(output) : [];
  } catch (error) {
    throw new Error(`Unable to inspect fixed-port owners with PowerShell: ${error.message}`);
  }
}

function formatPortOwner(owner) {
  return `  ${owner.protocol.toUpperCase()} ${owner.port} (${owner.address}) -> ${owner.process} PID ${owner.pid}` +
    (owner.commandLine ? ` | ${owner.commandLine}` : "");
}

function isKnownMudraOwner(owner) {
  const commandLine = String(owner.commandLine || "").toLowerCase().replace(/\//g, "\\");
  const root = ROOT.toLowerCase().replace(/\//g, "\\");
  return owner.process.toLowerCase() === "node.exe" && commandLine.includes(root);
}

function findUnmanagedMudraOwners(owners) {
  const known = owners.filter(isKnownMudraOwner);
  const byPid = new Map();
  for (const owner of owners) {
    if (!byPid.has(owner.pid)) byPid.set(owner.pid, []);
    byPid.get(owner.pid).push(owner);
  }
  for (const [pid, processOwners] of byPid) {
    const commandLine = String(processOwners[0].commandLine || "").toLowerCase().replace(/\//g, "\\");
    const ownsRecognitionPorts =
      processOwners.some(owner => owner.port === 5005 && owner.protocol === "udp") &&
      processOwners.some(owner => owner.port === 8080 && owner.protocol === "tcp");
    if (processOwners[0].process.toLowerCase() === "node.exe" &&
        ownsRecognitionPorts &&
        /(?:^|[\\\s"])udp_bridge\.js(?:["\s]|$)/i.test(commandLine)) {
      known.push(...processOwners.filter(owner => owner.pid === pid));
    }
  }
  return [...new Map(known.map(owner => [owner.pid, owner])).values()];
}

async function stopUnmanagedMudraOwners() {
  const owners = getPortOwners();
  const mudraOwners = findUnmanagedMudraOwners(owners);
  if (mudraOwners.length === 0) {
    console.log("No lifecycle-managed MUDRA instance is running.");
    const occupied = owners.filter(owner => !isKnownMudraOwner(owner));
    if (occupied.length) {
      console.log("Unrecognized applications are using fixed ports; they were not terminated:");
      for (const owner of occupied) console.log(formatPortOwner(owner));
    }
    return true;
  }

  console.log("Stopping verified, unmanaged MUDRA service process(es):");
  for (const owner of mudraOwners) console.log(formatPortOwner(owner));
  for (const owner of mudraOwners) {
    if (process.platform === "win32") {
      execFileSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `Stop-Process -Id ${owner.pid} -Force -ErrorAction Stop`
      ], { encoding: "utf8", timeout: 10000, windowsHide: true });
    } else {
      process.kill(owner.pid, "SIGTERM");
    }
  }
  await sleep(500);
  const remaining = getPortOwners().filter(owner =>
    mudraOwners.some(stopped => stopped.pid === owner.pid)
  );
  if (remaining.length) {
    console.error("Some verified MUDRA listeners remain after stop:");
    for (const owner of remaining) console.error(formatPortOwner(owner));
    return false;
  }
  console.log("Verified unmanaged MUDRA listeners stopped.");
  return true;
}

async function requestControl(command, timeoutMs = 1500) {
  return new Promise(resolve => {
    const socket = net.createConnection(CONTROL_ADDRESS);
    let response = "";
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once("connect", () => socket.write(`${JSON.stringify({ command })}\n`));
    socket.on("data", chunk => {
      response += chunk.toString("utf8");
      const lineEnd = response.indexOf("\n");
      if (lineEnd !== -1) {
        clearTimeout(timer);
        try {
          finish(JSON.parse(response.slice(0, lineEnd)));
        } catch {
          finish(null);
        }
      }
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(null);
    });
  });
}

async function waitForLockRelease(timeoutMs = SHUTDOWN_TIMEOUT_MS + 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await fsp.stat(LOCK_DIRECTORY).catch(() => null))) return true;
    await sleep(100);
  }
  return false;
}

async function stopExistingInstance() {
  const owner = await readOwner();
  if (!owner) {
    if (await fsp.stat(LOCK_DIRECTORY).catch(() => null)) {
      console.error("MUDRA lock exists but has no valid owner record; refusing to remove it automatically.");
      return false;
    }
    return stopUnmanagedMudraOwners();
  }

  const response = await requestControl("STOP");
  if (!response || !response.ok) {
    if (isProcessAlive(owner.pid)) {
      console.error(`MUDRA PID ${owner.pid} is alive but its control channel is unavailable; refusing to kill it.`);
      return false;
    }
    console.log("Found a stale MUDRA lock; reclaiming it safely.");
    const result = await acquireInstanceLock(LOCK_DIRECTORY, {
      pid: process.pid,
      lockToken: crypto.randomBytes(16).toString("hex"),
      controlAddress: CONTROL_ADDRESS
    });
    if (!result.acquired) return false;
    await releaseInstanceLock(LOCK_DIRECTORY, result.owner.lockToken);
    return true;
  }

  console.log(`Stopping MUDRA instance PID ${owner.pid}...`);
  const stopped = await waitForLockRelease();
  if (!stopped) {
    console.error("Timed out waiting for the owned MUDRA services to stop.");
    return false;
  }
  console.log("MUDRA services stopped.");
  return true;
}

async function printStatus() {
  const owner = await readOwner();
  if (owner && isProcessAlive(owner.pid)) {
    const response = await requestControl("STATUS");
    console.log(response && response.ok
      ? `MUDRA running (PID ${owner.pid}); services: ${response.services.join(", ")}`
      : `MUDRA startup/shutdown in progress (PID ${owner.pid}).`);
  } else {
    console.log("MUDRA lifecycle manager is not running.");
  }

  const occupied = getPortOwners();
  const managedPids = new Set(
    owner && isProcessAlive(owner.pid)
      ? ((await requestControl("STATUS"))?.processes || []).map(service => service.pid)
      : []
  );
  if (occupied.length) {
    const mudraOwners = findUnmanagedMudraOwners(
      occupied.filter(portOwner => !managedPids.has(portOwner.pid))
    );
    if (mudraOwners.length) {
      console.log("MUDRA services are already running outside the lifecycle lock:");
      for (const ownerEntry of mudraOwners) console.log(formatPortOwner(ownerEntry));
      console.log('Use "npm.cmd run restart" to replace a verified MUDRA instance; unrecognized applications are never terminated.');
    }
    console.log("Required fixed ports currently occupied:");
    for (const ownerEntry of occupied) console.log(formatPortOwner(ownerEntry));
  } else {
    console.log("Required fixed ports are free.");
  }
}

function serviceDefinitions() {
  return [
    {
      name: "RECOGNITION",
      script: path.join(ROOT, "3 INTEGRATION V2", "udp_bridge.js"),
      cwd: path.join(ROOT, "3 INTEGRATION V2"),
      env: {
        UDP_PORT: "5005",
        UDP_HOST: "0.0.0.0",
        WS_PORT: "8080",
        WS_HOST: "0.0.0.0",
        WS_ENABLE: "true"
      },
      ready: /MUDRA services ready: UDP 5005, WebSocket 8080/
    },
    {
      name: "SENTENCE-M4",
      script: path.join(ROOT, "services", "sentence-service", "server.js"),
      cwd: path.join(ROOT, "services", "sentence-service"),
      env: { PORT: "3000" },
      ready: /Module 4 running at http:\/\/localhost:3000/
    },
    {
      name: "FRONTEND-UI",
      script: path.join(ROOT, "frontend", "dev-server.js"),
      cwd: path.join(ROOT, "frontend"),
      args: [],
      env: {},
      ready: /MUDRA Vite ready: http:\/\/127\.0\.0\.1:5173/
    }
  ];
}

function spawnService(definition, childProcesses) {
  const child = spawn(process.execPath, [definition.script, ...(definition.args || [])], {
    cwd: definition.cwd,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, ...definition.env, FORCE_COLOR: "true" },
    windowsHide: true
  });
  childProcesses.set(definition.name, { child, ready: false });

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const handleOutput = (stream, isError) => {
    let pending = "";
    stream.on("data", chunk => {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        console.log(`[${definition.name}${isError ? " ERR" : ""}] ${line.trim()}`);
        if (!isError && !childProcesses.get(definition.name).ready && definition.ready.test(line)) {
          childProcesses.get(definition.name).ready = true;
          resolveReady();
        }
      }
    });
    stream.on("end", () => {
      if (pending.trim()) console.log(`[${definition.name}${isError ? " ERR" : ""}] ${pending.trim()}`);
    });
  };
  handleOutput(child.stdout, false);
  handleOutput(child.stderr, true);

  child.once("error", error => {
    rejectReady(new Error(`${definition.name} failed to start: ${error.message}`));
  });
  child.once("exit", (code, signal) => {
    const state = childProcesses.get(definition.name);
    if (state && !state.ready) {
      rejectReady(new Error(`${definition.name} exited before readiness (code ${code}, signal ${signal || "none"}).`));
    }
    console.log(`[${definition.name}] exited (code ${code}, signal ${signal || "none"}).`);
  });

  return { child, ready };
}

async function waitForServices(childProcesses, readinessPromises) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${STARTUP_TIMEOUT_MS / 1000}s waiting for fixed-port services.`)), STARTUP_TIMEOUT_MS).unref();
  });
  await Promise.race([Promise.all(readinessPromises), timeout]);
  for (const [name, state] of childProcesses) {
    if (!state.child || state.child.exitCode !== null) {
      throw new Error(`${name} exited during startup.`);
    }
  }
}

async function stopChildren(childProcesses) {
  const owned = [...childProcesses.values()].map(item => item.child).filter(child => child && child.exitCode === null);
  for (const child of owned) {
    try {
      if (child.connected) child.send({ type: "shutdown" });
      else child.kill("SIGTERM");
    } catch (error) {
      console.error(`Could not signal owned child PID ${child.pid}: ${error.message}`);
    }
  }

  await Promise.race([
    Promise.all(owned.map(child => child.exitCode !== null
      ? Promise.resolve()
      : new Promise(resolve => child.once("exit", resolve)))),
    sleep(SHUTDOWN_TIMEOUT_MS)
  ]);

  for (const child of owned) {
    if (child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch (error) {
        console.error(`Could not force-stop owned child PID ${child.pid}: ${error.message}`);
      }
    }
  }
}

async function startManager() {
  const lockToken = crypto.randomBytes(16).toString("hex");
  const lockResult = await acquireInstanceLock(LOCK_DIRECTORY, {
    pid: process.pid,
    root: ROOT,
    lockToken,
    controlAddress: CONTROL_ADDRESS,
    startedAt: new Date().toISOString()
  });
  if (!lockResult.acquired) {
    console.error(`MUDRA already running (PID ${lockResult.owner ? lockResult.owner.pid : "unknown"}). Use "npm.cmd run stop" or "npm.cmd run restart".`);
    return 1;
  }

  const childProcesses = new Map();
  let controlServer;
  let shuttingDown = false;
  let startupComplete = false;
  let exitCode = 0;
  let resolveShutdown;
  const shutdownFinished = new Promise(resolve => { resolveShutdown = resolve; });

  const shutdown = async (reason, code = 0) => {
    if (shuttingDown) return shutdownFinished;
    shuttingDown = true;
    exitCode = code;
    console.log(`\nStopping MUDRA services (${reason})...`);
    if (controlServer) {
      await new Promise(resolve => controlServer.close(resolve));
      controlServer = null;
    }
    await stopChildren(childProcesses);
    await releaseInstanceLock(LOCK_DIRECTORY, lockToken).catch(error => {
      console.error(`Could not release MUDRA lock: ${error.message}`);
      exitCode = 1;
    });
    resolveShutdown();
    return shutdownFinished;
  };

  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

  try {
    controlServer = net.createServer(socket => {
      let data = "";
      socket.on("data", chunk => {
        data += chunk.toString("utf8");
        const lineEnd = data.indexOf("\n");
        if (lineEnd === -1) return;
        let request;
        try {
          request = JSON.parse(data.slice(0, lineEnd));
        } catch {
          socket.end(`${JSON.stringify({ ok: false, error: "Invalid request" })}\n`);
          return;
        }
        if (request.command === "STATUS") {
          socket.end(`${JSON.stringify({
            ok: true,
            services: [...childProcesses.entries()]
              .filter(([, state]) => state.ready && state.child.exitCode === null)
              .map(([name]) => name),
            processes: [...childProcesses.entries()]
              .filter(([, state]) => state.child.exitCode === null)
              .map(([name, state]) => ({ name, pid: state.child.pid }))
          })}\n`);
        } else if (request.command === "STOP") {
          socket.end(`${JSON.stringify({ ok: true, status: "stopping" })}\n`);
          setImmediate(() => { void shutdown("stop command"); });
        } else {
          socket.end(`${JSON.stringify({ ok: false, error: "Unknown command" })}\n`);
        }
      });
    });
    await new Promise((resolve, reject) => {
      controlServer.once("error", reject);
      controlServer.listen(CONTROL_ADDRESS, resolve);
    });

    const occupied = getPortOwners();
    if (occupied.length) {
      const mudraOwners = occupied.filter(isKnownMudraOwner);
      if (mudraOwners.length) {
        console.error("MUDRA already running, but it is not owned by this lifecycle manager. No process was terminated.");
        for (const owner of mudraOwners) console.error(formatPortOwner(owner));
        console.error('Use "npm.cmd run restart" for a lifecycle-managed instance. Unmanaged PIDs are never terminated automatically.');
      } else {
        console.error("Cannot start MUDRA: required fixed ports are occupied. No processes were terminated and Vite will not use another port.");
      }
      for (const owner of occupied) console.error(formatPortOwner(owner));
      exitCode = 1;
      await shutdown("port preflight failed", 1);
      return exitCode;
    }

    console.log("Starting MUDRA on fixed ports: UDP 5005, WebSocket 8080, HTTP 3000, Vite 5173.");
    const readiness = [];
    for (const definition of serviceDefinitions()) {
      const launched = spawnService(definition, childProcesses);
      readiness.push(launched.ready);
      launched.child.once("exit", (code, signal) => {
        if (!shuttingDown && (startupComplete || code !== 0)) {
          void shutdown(`${definition.name} exited (code ${code}, signal ${signal || "none"})`, code === 0 ? 1 : code || 1);
        }
      });
    }

    await waitForServices(childProcesses, readiness);
    startupComplete = true;
    console.log("\nMUDRA is ready: UDP 5005, WebSocket 8080, HTTP 3000, frontend 5173.");
    await shutdownFinished;
    return exitCode;
  } catch (error) {
    console.error(`[STARTUP ERROR] ${error.message}`);
    await shutdown("startup failure", 1);
    return 1;
  } finally {
    if (controlServer) controlServer.close();
  }
}

async function startCommand() {
  const owner = await readOwner();
  if (owner && isProcessAlive(owner.pid)) {
    const status = await requestControl("STATUS");
    console.error(`MUDRA already running (PID ${owner.pid}). Use "npm.cmd run stop" or "npm.cmd run restart".`);
    if (status && status.services) console.error(`Services: ${status.services.join(", ") || "starting"}`);
    return 1;
  }

  const result = await startManager();
  if (result !== 0) process.exitCode = result;
  return result;
}

async function restartCommand() {
  const stopped = await stopExistingInstance();
  if (!stopped) return 1;
  return startCommand();
}

async function main(command = process.argv[2] || "start") {
  try {
    switch (command) {
      case "start":
        return startCommand();
      case "stop":
        return (await stopExistingInstance()) ? 0 : 1;
      case "restart":
        return restartCommand();
      case "status":
        await printStatus();
        return 0;
      default:
        console.error(`Unknown command "${command}". Use start, stop, restart, or status.`);
        return 2;
    }
  } catch (error) {
    console.error(`[MUDRA ${command.toUpperCase()} ERROR] ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  main().then(code => {
    if (code !== undefined) process.exitCode = code;
  });
}

module.exports = {
  PORTS,
  acquireInstanceLock,
  releaseInstanceLock,
  getPortOwners,
  serviceDefinitions
};
