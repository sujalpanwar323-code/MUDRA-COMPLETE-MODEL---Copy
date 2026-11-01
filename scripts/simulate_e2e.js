/**
 * Exercises the live local pipeline:
 * ESP-shaped UDP packets -> Module 2 -> Module 3 -> WebSocket -> Module 4.
 * Also checks that hardware mode 1 uses the deterministic emergency path.
 */
const path = require("node:path");
const dgram = require("node:dgram");
const http = require("node:http");
const WebSocket = require(path.join(
  __dirname,
  "../3 INTEGRATION V2/node_modules/ws"
));
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const RECOGNITION_DIR = path.join(ROOT, "3 INTEGRATION V2");
const SENTENCE_DIR = path.join(ROOT, "services", "sentence-service");
const {
  module2,
  startBridge,
  closeBridge,
  PORT: UDP_PORT,
  WS_PORT
} = require(path.join(RECOGNITION_DIR, "udp_bridge.js"));

function waitForMessage(socket, type, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for WebSocket event ${type}.`));
    }, timeoutMs);
    function onMessage(raw) {
      let message;
      try { message = JSON.parse(raw.toString("utf8")); } catch { return; }
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    }
    socket.on("message", onMessage);
  });
}

function packet(seq, mode, fingers, distanceCm = 10) {
  return {
    device: "MUDRA_E2E",
    seq,
    timestamp_ms: seq * 100,
    mode,
    emergency_mode: mode === 1,
    fingers,
    ultrasonic: { valid: true, distance_cm: distanceCm },
    gesture_code: 0
  };
}

function sendUdp(socket, data) {
  const bytes = Buffer.from(JSON.stringify(data), "utf8");
  return new Promise((resolve, reject) => {
    socket.send(bytes, UDP_PORT, "127.0.0.1", error =>
      error ? reject(error) : resolve()
    );
  });
}

function postSentence(keywords) {
  const body = JSON.stringify({ keywords, lang: "en" });
  return new Promise((resolve, reject) => {
    const request = http.request("http://127.0.0.1:3000/sentence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, response => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { raw += chunk; });
      response.on("end", () => {
        try {
          const result = JSON.parse(raw);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Module 4 returned HTTP ${response.statusCode}.`));
            return;
          }
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    request.once("error", reject);
    request.end(body);
  });
}

async function sendGesture(socket, mode, flex, firstSeq) {
  const fingers = {
    thumb: flex[0] === "1",
    index: flex[1] === "1",
    middle: flex[2] === "1",
    ring: flex[3] === "1",
    little: flex[4] === "1"
  };
  for (let i = 0; i < 10; i += 1) {
    await sendUdp(socket, packet(firstSeq + i, mode, fingers));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const open = { thumb: false, index: false, middle: false, ring: false, little: false };
  for (let i = 0; i < 10; i += 1) {
    await sendUdp(socket, packet(firstSeq + 10 + i, mode, open));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function run() {
  process.env.PORT = "3000";
  process.env.BUDGET_MS = "1200";
  const sentenceModule = await import(
    pathToFileURL(path.join(SENTENCE_DIR, "server.js")).href
  );
  const sentenceServer = sentenceModule.httpServer;
  let frontend;
  let sender;

  try {
    const addresses = await startBridge();
    frontend = new WebSocket(`ws://127.0.0.1:${addresses.websocket?.port || WS_PORT}`);
    await new Promise((resolve, reject) => {
      frontend.once("open", resolve);
      frontend.once("error", reject);
    });
    sender = dgram.createSocket("udp4");

    const telemetryEvent = waitForMessage(frontend, "telemetry");
    const normalEvent = waitForMessage(frontend, "recognized_keywords");
    await sendGesture(sender, 0, "00001", 1);
    const telemetry = await telemetryEvent;
    const recognized = await normalEvent;
    if (telemetry.seq !== 1 || !Array.isArray(telemetry.flex)) {
      throw new Error("Frontend telemetry did not contain the ESP packet fields.");
    }
    if (recognized.keywords[0] !== "STOP") {
      throw new Error(`Expected STOP from Module 3, received ${JSON.stringify(recognized)}.`);
    }

    const sentence = await postSentence(recognized.keywords);
    if (typeof sentence.sentence !== "string" || !sentence.sentence.trim()) {
      throw new Error("Module 4 returned an empty sentence.");
    }

    const emergencyEvent = waitForMessage(frontend, "EMERGENCY_RESULT");
    await sendGesture(sender, 1, "00001", 21);
    const emergency = await emergencyEvent;
    if (emergency.status !== "MATCH" || emergency.sentence !== "I need help.") {
      throw new Error(`Unexpected emergency result: ${JSON.stringify(emergency)}.`);
    }

    console.log("E2E pipeline succeeded:");
    console.log(`  UDP -> Module 2 -> Module 3: ${recognized.keywords.join(" ")}`);
    console.log(`  Module 3 -> Module 4 -> frontend flow: ${sentence.sentence}`);
    console.log(`  Hardware mode 1 emergency: ${emergency.sentence}`);
  } finally {
    module2.reset();
    if (sender) sender.close();
    if (frontend) {
      await new Promise(resolve => {
        if (frontend.readyState === WebSocket.CLOSED) return resolve();
        frontend.once("close", resolve);
        frontend.close();
      });
    }
    await closeBridge().catch(() => {});
    if (sentenceServer && sentenceServer.listening) {
      await new Promise(resolve => sentenceServer.close(resolve));
    }
  }
}

run().catch(error => {
  console.error("E2E pipeline failed:", error.message);
  process.exitCode = 1;
});
