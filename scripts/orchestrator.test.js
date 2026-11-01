const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  PORTS,
  acquireInstanceLock,
  releaseInstanceLock,
  serviceDefinitions
} = require("./orchestrate_pipeline");

async function createTemporaryLock(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-lock-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, "instance.lock");
}

test("single-instance lock allows only one concurrent owner", async t => {
  const lockDirectory = await createTemporaryLock(t);
  const [first, second] = await Promise.all([
    acquireInstanceLock(lockDirectory, { pid: process.pid, lockToken: "first" }),
    acquireInstanceLock(lockDirectory, { pid: process.pid, lockToken: "second" })
  ]);

  assert.equal(Number(first.acquired) + Number(second.acquired), 1);
  const owner = first.acquired ? first.owner : second.owner;
  assert.equal(await releaseInstanceLock(lockDirectory, owner.lockToken), true);
});

test("stale lock with a dead owner is reclaimed safely", async t => {
  const lockDirectory = await createTemporaryLock(t);
  await fs.mkdir(lockDirectory);
  await fs.writeFile(
    path.join(lockDirectory, "owner.json"),
    JSON.stringify({ pid: 2147483647, lockToken: "stale" })
  );

  const result = await acquireInstanceLock(lockDirectory, {
    pid: process.pid,
    lockToken: "current"
  });
  assert.equal(result.acquired, true);
  assert.equal(result.owner.lockToken, "current");
  assert.equal(await releaseInstanceLock(lockDirectory, "current"), true);
});

test("lock release cannot remove a different owner's lock", async t => {
  const lockDirectory = await createTemporaryLock(t);
  const result = await acquireInstanceLock(lockDirectory, {
    pid: process.pid,
    lockToken: "owner"
  });

  assert.equal(await releaseInstanceLock(lockDirectory, "not-owner"), false);
  assert.equal((await fs.stat(lockDirectory)).isDirectory(), true);
  assert.equal(await releaseInstanceLock(lockDirectory, result.owner.lockToken), true);
});

test("production ports remain fixed and distinct", () => {
  assert.deepEqual(
    PORTS.map(({ port }) => port).sort((left, right) => left - right),
    [3000, 5005, 5173, 8080]
  );
});

test("service readiness markers match each fixed-port service", () => {
  const expected = new Map([
    ["RECOGNITION", "[PIPELINE] MUDRA services ready: UDP 5005, WebSocket 8080"],
    ["SENTENCE-M4", "Module 4 running at http://localhost:3000"],
    ["FRONTEND-UI", "MUDRA Vite ready: http://127.0.0.1:5173"]
  ]);
  for (const service of serviceDefinitions()) {
    assert.equal(service.ready.test(expected.get(service.name)), true, service.name);
  }
});
