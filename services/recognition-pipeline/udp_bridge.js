/**
 * MUDRA System - Module 1 to Module 2 & Module 3 UDP Ingestion Bridge
 * File: udp_bridge.js
 *
 * Description:
 * Ingests raw UDP sensor packets from the ESP32 (Module 1) over port 5005,
 * validates and adapts the packet schema, quantizes ultrasonic distance, feeds
 * frames sequentially into Module 2 (Stateful Windowing & Normalization), and
 * upon receiving BATCH_READY (10/10 strict REST), adapts the gesture batch
 * into Module 3's contract and triggers keyword recognition.
 *
 * Pipeline Flow:
 * [ESP32 Glove] -> UDP Port 5005 -> [udp_bridge.js]
 *   -> Module 2 (Windowing & REST Detection)
 *   -> BATCH_READY
 *   -> Boundary Adapter (Flex object {f1..f5} to 5-bit binary string)
 *   -> Module 3 (Gesture Library Lookup & Keyword Output)
 */

const fs = require("fs");
const path = require("path");
const dgram = require("dgram");

// Load local .env if available
const localEnv = path.join(__dirname, ".env");
if (fs.existsSync(localEnv) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(localEnv); } catch (_) {}
}

const { createModule2 } = require("./backend/module2/index");
const { createModule3 } = require("./src/index");

// Configuration
const PORT = parseInt(process.env.UDP_PORT || "5005", 10);
const HOST = process.env.UDP_HOST || "0.0.0.0";
const WS_PORT = parseInt(process.env.WS_PORT || "8080", 10);
const WS_HOST = process.env.WS_HOST || "0.0.0.0";
const WS_ENABLE = process.env.WS_ENABLE !== "false";
const PIPELINE_DEBUG = process.env.PIPELINE_DEBUG === "true";
const DIAGNOSTIC_INTERVAL_MS = 5000;

const pipelineStats = {
  received: 0,
  parsed: 0,
  parseFailures: 0,
  packetValidationFailures: 0,
  module2Events: Object.create(null),
  module2AcceptedGestures: 0,
  batches: 0,
  module3Matches: 0,
  module3NoMatches: 0,
  module3Invalid: 0,
  websocketAccepted: 0,
  websocketFailed: 0
};

let lastDiagnosticLogTime = 0;
let packetsSinceDiagnosticLog = 0;
let lastRawPacketInfo = null;

function logPipelineSummary() {
  const module2Events = Object.entries(pipelineStats.module2Events)
    .map(([type, count]) => `${type}=${count}`)
    .join(" ") || "none";
  console.log(
    `[PIPELINE] UDP received=${pipelineStats.received} parsed=${pipelineStats.parsed} ` +
    `parse_failed=${pipelineStats.parseFailures} packet_rejected=${pipelineStats.packetValidationFailures}; ` +
    `M2 accepted=${pipelineStats.module2AcceptedGestures} batches=${pipelineStats.batches} ` +
    `events={${module2Events}}; ` +
    `M3 match=${pipelineStats.module3Matches} no_match=${pipelineStats.module3NoMatches} ` +
    `invalid=${pipelineStats.module3Invalid}; ` +
    `WS accepted=${pipelineStats.websocketAccepted} failed=${pipelineStats.websocketFailed}`
  );
}

if (PIPELINE_DEBUG) {
  const diagnosticsTimer = setInterval(logPipelineSummary, DIAGNOSTIC_INTERVAL_MS);
  diagnosticsTimer.unref();
}

// Instantiate isolated Module 2 and Module 3 processors
const module2 = createModule2();
const module3 = createModule3({
  frontendWebSocket: {
    role: "server",
    host: WS_HOST,
    port: WS_PORT
  }
});

/**
 * Quantizes continuous ultrasonic distance in cm into discrete distance states:
 * - (0.0, 15.0]  => "LOW"  (Zone 1, stable: true)
 * - (15.0, 35.0] => "MID"  (Zone 2, stable: true)
 * - > 35.0       => "HIGH" (Zone 3, stable: true)
 * - invalid / missing / null / out of bounds => distance_state: null, zone: null, stable: false
 *
 * Note: Invalid readings are never fabricated into valid distance states.
 *
 * @param {object} ultrasonic Raw ultrasonic object from Module 1
 * @returns {{ distance_state: "LOW" | "MID" | "HIGH" | null, zone: 1 | 2 | 3 | null, stable: boolean }}
 */
function quantizeDistance(ultrasonic) {
  if (
    !ultrasonic ||
    typeof ultrasonic !== "object" ||
    Array.isArray(ultrasonic) ||
    ultrasonic.valid !== true ||
    typeof ultrasonic.distance_cm !== "number" ||
    isNaN(ultrasonic.distance_cm) ||
    ultrasonic.distance_cm <= 0
  ) {
    return {
      distance_state: null,
      zone: null,
      stable: false
    };
  }

  const cm = ultrasonic.distance_cm;
  if (cm <= 15.0) {
    return { distance_state: "LOW", zone: 1, stable: true };
  } else if (cm <= 35.0) {
    return { distance_state: "MID", zone: 2, stable: true };
  } else {
    return { distance_state: "HIGH", zone: 3, stable: true };
  }
}

/**
 * Adapts raw Module 1 ESP32 JSON payload into Module 2 input frame contract.
 *
 * Strictly validates data types:
 * - Fingers must be explicit booleans (not strings or missing values).
 * - Mode must be integer 0 or 1.
 * - Flex fields (f1..f5) map to thumb, index, middle, ring, little.
 *
 * @param {object} raw Parsed JSON packet from ESP32
 * @returns {object} Module 2 compatible input packet
 */
function adaptModule1Packet(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Raw packet must be a non-null JSON object");
  }

  // Validate mode
  if (
    raw.mode === undefined ||
    typeof raw.mode !== "number" ||
    !Number.isInteger(raw.mode) ||
    (raw.mode !== 0 && raw.mode !== 1)
  ) {
    throw new TypeError("Packet mode must be integer 0 or 1");
  }

  // Validate fingers object
  if (!raw.fingers || typeof raw.fingers !== "object" || Array.isArray(raw.fingers)) {
    throw new TypeError("Packet fingers must be a non-null object");
  }

  const fingerKeys = ["thumb", "index", "middle", "ring", "little"];
  for (const finger of fingerKeys) {
    if (typeof raw.fingers[finger] !== "boolean") {
      throw new TypeError(`Finger '${finger}' must be a boolean`);
    }
  }

  const thumb = raw.fingers.thumb;
  const index = raw.fingers.index;
  const middle = raw.fingers.middle;
  const ring = raw.fingers.ring;
  const little = raw.fingers.little;

  const { distance_state, zone, stable } = quantizeDistance(raw.ultrasonic);

  const rawDistCm =
    raw.ultrasonic &&
    typeof raw.ultrasonic.distance_cm === "number" &&
    !isNaN(raw.ultrasonic.distance_cm)
      ? raw.ultrasonic.distance_cm
      : null;

  return {
    device: typeof raw.device === "string" ? raw.device : "MUDRA_01",
    seq: typeof raw.seq === "number" ? raw.seq : null,
    sequence_id: typeof raw.seq === "number" ? raw.seq : Date.now(),
    mode: raw.mode,
    fingers: {
      thumb,
      index,
      middle,
      ring,
      little
    },
    flex: {
      f1: thumb,
      f2: index,
      f3: middle,
      f4: ring,
      f5: little
    },
    ultrasonic: {
      zone,
      stable,
      distance_cm: rawDistCm
    },
    distance_state,
    gesture_code: typeof raw.gesture_code === "number" ? raw.gesture_code : null
  };
}

/**
 * Boundary Adapter:
 * Converts Module 2 output batch gestures into Module 3's expected 5-bit binary string format.
 * Maps object-based flex: { f1: thumb, f2: index, f3: middle, f4: ring, f5: little }
 * to a strictly validated 5-character binary string: "f1 f2 f3 f4 f5" (e.g. "00001").
 *
 * @param {Array<object>} gestures Array of gestures from Module 2 (result.batch.gestures)
 * @returns {Array<object>} Module 3 processModule2Message-compatible array
 */
function adaptBatchForModule3(gestures) {
  if (!Array.isArray(gestures)) {
    throw new TypeError("Gestures must be an array of gesture objects");
  }

  return gestures.map((gesture, idx) => {
    if (!gesture || typeof gesture !== "object" || Array.isArray(gesture)) {
      throw new TypeError(`Gesture at index ${idx} must be a non-null object`);
    }

    let flex = gesture.flex;
    if (typeof flex === "object" && flex !== null) {
      const f1 = flex.f1 ? "1" : "0";
      const f2 = flex.f2 ? "1" : "0";
      const f3 = flex.f3 ? "1" : "0";
      const f4 = flex.f4 ? "1" : "0";
      const f5 = flex.f5 ? "1" : "0";
      flex = `${f1}${f2}${f3}${f4}${f5}`;
    }

    return {
      sequence_id: typeof gesture.sequence_id === "number" ? gesture.sequence_id : idx + 1,
      mode: typeof gesture.mode === "number" ? gesture.mode : 0,
      flex,
      distance_state: typeof gesture.distance_state === "string" ? gesture.distance_state : "HIGH"
    };
  });
}

/**
 * Processes a single raw packet through the complete Module 1 -> Module 2 -> Module 3 pipeline.
 *
 * @param {object} rawData Raw parsed packet from UDP datagram
 * @param {{ address: string, port: number }} [rinfo] Optional source network info for logging
 * @returns {Promise<{ eventResult: object, recognition: object|null }>}
 */
async function processRawPacket(rawData, rinfo = { address: "127.0.0.1", port: 0 }) {
  let normalizedPacket;
  try {
    normalizedPacket = adaptModule1Packet(rawData);
  } catch (error) {
    pipelineStats.packetValidationFailures += 1;
    throw error;
  }
  const eventResult = module2.processReading(normalizedPacket);
  pipelineStats.module2Events[eventResult.type] =
    (pipelineStats.module2Events[eventResult.type] || 0) + 1;

  // Broadcast live telemetry to connected WebSocket frontend clients (Phase 5)
  if (module3.frontendTransport && module3.frontendTransport.started) {
    try {
      module3.frontendTransport.send({
        type: "telemetry",
        gesture: eventResult.type === "GESTURE_ACCEPTED" ? "GESTURE_COLLECTING" : (eventResult.type || "IDLE"),
        source: "esp32",
        flex: [
          normalizedPacket.fingers.thumb ? 85 : 15,
          normalizedPacket.fingers.index ? 85 : 15,
          normalizedPacket.fingers.middle ? 85 : 15,
          normalizedPacket.fingers.ring ? 85 : 15,
          normalizedPacket.fingers.little ? 85 : 15
        ],
        rawFingers: normalizedPacket.fingers,
        mode: normalizedPacket.mode,
        ultrasonic: normalizedPacket.ultrasonic,
        distance_state: normalizedPacket.distance_state,
        confidence: 0.95,
        seq: normalizedPacket.seq,
        m2State: module2.getState(),
        m2LastEvent: eventResult.type,
        timestamp: Date.now()
      });
    } catch (_) {}
  }

  // Format per-packet log
  const seqStr = normalizedPacket.seq !== null ? `#${normalizedPacket.seq}` : "N/A";
  const flexStr =
    `T:${normalizedPacket.fingers.thumb ? 1 : 0} ` +
    `I:${normalizedPacket.fingers.index ? 1 : 0} ` +
    `M:${normalizedPacket.fingers.middle ? 1 : 0} ` +
    `R:${normalizedPacket.fingers.ring ? 1 : 0} ` +
    `L:${normalizedPacket.fingers.little ? 1 : 0}`;
  const distStateStr = normalizedPacket.distance_state || "INVALID/UNSTABLE";
  const rawCmStr =
    rawData.ultrasonic &&
    rawData.ultrasonic.valid === true &&
    typeof rawData.ultrasonic.distance_cm === "number"
      ? `${rawData.ultrasonic.distance_cm.toFixed(1)}cm`
      : "N/A";
  const gestureCodeStr =
    normalizedPacket.gesture_code !== null
      ? ` | Code: ${normalizedPacket.gesture_code}`
      : "";

  if (PIPELINE_DEBUG && eventResult.type !== "WINDOW_COLLECTING" && eventResult.type !== "WAITING") {
    console.log(
      `[PIPELINE] UDP ${seqStr} ${rinfo.address}:${rinfo.port} | ` +
      `Mode:${normalizedPacket.mode} Fingers[${flexStr}] Dist:${distStateStr}(${rawCmStr})` +
      `${gestureCodeStr} | M2 ${module2.getState()} -> ${eventResult.type}`
    );
  }

  let recognition = null;

  // Handle Module 2 Pipeline Emissions
  if (eventResult.type === "BATCH_READY") {
    pipelineStats.batches += 1;
    const rawGestures = eventResult.batch?.gestures || [];
    console.log(`[MODULE2] Batch ready: ${rawGestures.length} gesture(s) in sequence`);

    // 1. Boundary adaptation
    const adaptedBatch = adaptBatchForModule3(rawGestures);
    console.log(`[ADAPTER] Batch validated and adapted (${adaptedBatch.length} frames)`);

    // 2. Invoke Module 3 public recognition API
    console.log(`[MODULE3] Recognition started`);
    recognition = await module3.processModule2Message(adaptedBatch);
    if (recognition.success) {
      for (const result of recognition.results || []) {
        if (result.status === "recognized") pipelineStats.module3Matches += 1;
        else if (result.status === "no_match") pipelineStats.module3NoMatches += 1;
        else if (result.status === "invalid_record") pipelineStats.module3Invalid += 1;
      }
    } else {
      pipelineStats.module3Invalid += 1;
    }
    if (recognition.delivery) {
      if (recognition.delivery.success) pipelineStats.websocketAccepted += 1;
      else pipelineStats.websocketFailed += 1;
    }
    if (PIPELINE_DEBUG) {
      console.log(
        `[PIPELINE] M3 status=${recognition.status || "unknown"} ` +
        `results=${(recognition.results || []).map(result => result.status).join(",") || "none"} ` +
        `keywords=${JSON.stringify(recognition.keywords || [])} ` +
        `WS=${recognition.delivery ? recognition.delivery.status : "not_sent"}`
      );
    }
    console.log(
      `[MODULE3] Recognition completed (Status: ${recognition.status ? recognition.status.toUpperCase() : "DONE"})`
    );

    if (module3.frontendTransport && module3.frontendTransport.started) {
      try {
        module3.frontendTransport.send({
          type: "diagnostic_status",
          batchSize: rawGestures.length,
          status: recognition.success && recognition.keywords && recognition.keywords.length > 0 ? "MATCH" : "NO_MATCH",
          keywords: recognition.keywords || [],
          results: recognition.results || [],
          timestamp: Date.now()
        });
      } catch (_) {}
    }

    // 3. Structured terminal output according to Section 5
    if (recognition.success && recognition.keywords && recognition.keywords.length > 0) {
      console.log(`[RESULT] Status: MATCH`);
      console.log(`[RESULT] Recognized keyword(s): ${recognition.keywords.join(", ")}`);
      if (recognition.results && recognition.results.length > 0) {
        recognition.results.forEach((item) => {
          console.log(
            `  Word #${item.sequence_id}: "${item.keyword}" (Pattern: ${item.pattern}, Source: ${item.source})`
          );
        });
      }
    } else if (recognition.success && (!recognition.keywords || recognition.keywords.length === 0)) {
      console.log(`[RESULT] Status: NO_MATCH`);
      console.log(`[RESULT] No supported keyword matched for current gesture sequence.`);
      if (recognition.results && recognition.results.length > 0) {
        recognition.results.forEach((item) => {
          console.log(
            `  Gesture #${item.sequence_id}: No match (Pattern: ${item.pattern}, Status: ${item.status})`
          );
        });
      }
    } else {
      console.log(`[RESULT] Status: INVALID_BATCH`);
      console.log(`[RESULT] Recognition error: ${recognition.error?.message || "Unknown error"}`);
    }
  } else if (eventResult.type === "EMPTY_SIGNING_SEQUENCE") {
    console.log(`[MODULE 2] Empty signing sequence detected. State reset to IDLE.`);
  } else if (eventResult.type === "WINDOW_REJECTED") {
    console.log(`[MODULE 2 WARN] Window rejected: ${eventResult.reason} (${eventResult.details || ""})`);
  } else if (eventResult.type === "GESTURE_ACCEPTED") {
    pipelineStats.module2AcceptedGestures += 1;
    console.log(
      `[MODULE2] Gesture accepted: Mode ${eventResult.gesture?.mode}, Dist: ${eventResult.gesture?.distance_state}`
    );
  }

  return { eventResult, recognition };
}

// Create UDP Socket
const server = dgram.createSocket("udp4");

server.on("listening", () => {
  const address = server.address();
  console.log(`[PIPELINE] Diagnostics ${PIPELINE_DEBUG ? "enabled" : "disabled"} (set PIPELINE_DEBUG=true for 5s counters).`);
  console.log("=================================================");
  console.log("   MUDRA Module 1 -> 2 -> 3 Ingestion Bridge     ");
  console.log(`   Status   : LISTENING                          `);
  console.log(`   Address  : ${address.address}                 `);
  console.log(`   Port     : ${address.port}                    `);
  if (WS_ENABLE && address.port === PORT &&
      module3.frontendTransport && !module3.frontendTransport.started) {
    module3.startWebSocketServer()
      .then(() => {
        console.log(`   WebSocket: ws://${WS_HOST}:${WS_PORT} (Live) `);
        console.log("   Module 3 : CONNECTED                          ");
        console.log("=================================================");
        console.log("[PIPELINE] MUDRA services ready: UDP 5005, WebSocket 8080");
      })
      .catch(error => {
        console.error(`[BRIDGE STARTUP ERROR] WebSocket ${WS_PORT} could not start: ${error.message}`);
        process.exitCode = 1;
        server.close();
      });
    console.log("=================================================");
    return;
  }
  console.log(`   WebSocket: disabled                         `);
  console.log("   Module 3 : CONNECTED                          ");
  console.log("=================================================");
  if (address.port === PORT) {
    console.log(`[PIPELINE] MUDRA services ready: UDP ${address.port}, WebSocket disabled`);
  }
});

server.on("close", () => {
  if (module3.frontendTransport && module3.frontendTransport.started) {
    try {
      module3.closeWebSocketServer();
    } catch (_) {}
  }
});

function shutdown() {
  const finish = () => {
    if (process.connected) process.disconnect();
  };
  const closeWebSocket = () => module3.closeWebSocketServer();
  if (!server.address()) {
    closeWebSocket().catch(error => {
      console.error(`[BRIDGE SHUTDOWN ERROR] ${error.message}`);
      process.exitCode = 1;
    }).finally(finish);
    return;
  }
  server.close(() => {
    closeWebSocket().catch(error => {
      console.error(`[BRIDGE SHUTDOWN ERROR] ${error.message}`);
      process.exitCode = 1;
    }).finally(finish);
  });
}

process.on("message", message => {
  if (message && message.type === "shutdown") shutdown();
});
process.once("SIGINT", shutdown);

server.on("message", async (rawBuffer, rinfo) => {
  pipelineStats.received += 1;
  packetsSinceDiagnosticLog += 1;
  const now = Date.now();
  let rawData = null;
  try {
    rawData = JSON.parse(rawBuffer.toString("utf8"));
    pipelineStats.parsed += 1;
    await processRawPacket(rawData, rinfo);
  } catch (err) {
    if (err instanceof SyntaxError) pipelineStats.parseFailures += 1;
    if (PIPELINE_DEBUG || pipelineStats.parseFailures + pipelineStats.packetValidationFailures <= 1) {
      console.warn(`[BRIDGE WARN] Dropping packet from ${rinfo.address}:${rinfo.port}: ${err.message}`);
    }
  }

  // Rate-limited terminal diagnostic (1 Hz) for Phase 2
  if (now - lastDiagnosticLogTime >= 1000) {
    const elapsed = (now - lastDiagnosticLogTime) / 1000;
    const rate = (packetsSinceDiagnosticLog / elapsed).toFixed(1);
    if (rawData && rawData.fingers) {
      const f = rawData.fingers;
      const flexLog = `T:${f.thumb ? 1 : 0} I:${f.index ? 1 : 0} M:${f.middle ? 1 : 0} R:${f.ring ? 1 : 0} L:${f.little ? 1 : 0}`;
      const distLog = rawData.ultrasonic && rawData.ultrasonic.valid
        ? `${rawData.ultrasonic.distance_cm}cm`
        : "N/A";
      console.log(`[ESP32 UDP] ${rate} pkts/sec from ${rinfo.address}:${rinfo.port} | Seq #${rawData.seq} | Mode: ${rawData.mode} | Fingers: [${flexLog}] | Dist: ${distLog} | M2 State: ${module2.getState()}`);
    }
    lastDiagnosticLogTime = now;
    packetsSinceDiagnosticLog = 0;
  }
});

server.on("error", (err) => {
  const reason = err.code === "EADDRINUSE"
    ? `UDP port ${PORT} is already in use`
    : err.message;
  console.error(`[BRIDGE STARTUP ERROR] ${reason} (${err.code || "socket error"})`);
  process.exitCode = 1;
  if (server.address()) server.close();
});

// Auto-bind when executed directly
if (require.main === module) {
  server.bind(PORT, HOST);
}

module.exports = {
  server,
  module2,
  module3,
  PORT,
  HOST,
  quantizeDistance,
  adaptModule1Packet,
  adaptBatchForModule3,
  processRawPacket
};
