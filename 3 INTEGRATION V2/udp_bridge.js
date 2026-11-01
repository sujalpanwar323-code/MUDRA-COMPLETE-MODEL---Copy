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

const dgram = require("dgram");
const { createModule2 } = require("./backend/module2/index");
const { createModule3 } = require("./src/index");

// Configuration
const PORT = parseInt(process.env.UDP_PORT || "5005", 10);
const HOST = process.env.UDP_HOST || "0.0.0.0";
const WS_PORT = parseInt(process.env.WS_PORT || "8080", 10);
const WS_HOST = process.env.WS_HOST || "0.0.0.0";
const WS_ENABLED = process.env.WS_ENABLE !== "false";

// Instantiate isolated Module 2 and Module 3 processors
const module2 = createModule2();
const module3 = createModule3({
  frontendWebSocket: { role: "server", host: WS_HOST, port: WS_PORT }
});
let module3SequenceCounter = 0;

/**
 * Quantizes continuous ultrasonic distance in cm into discrete distance states:
 * - [2.0, 15.0]  => "LOW"  (Zone 1, stable: true)
 * - (15.0, 35.0] => "MID"  (Zone 2, stable: true)
 * - > 35.0       => "HIGH" (Zone 3, stable: true)
 * - readings outside the HC-SR04 supported 2–400 cm range, or invalid/missing => null/unstable
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
    !Number.isFinite(ultrasonic.distance_cm) ||
    ultrasonic.distance_cm < 2 ||
    ultrasonic.distance_cm > 400
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
    emergency_mode: raw.emergency_mode === true,
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
      emergency_mode: gesture.emergency_mode === true,
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
  const normalizedPacket = adaptModule1Packet(rawData);
  const eventResult = module2.processReading(normalizedPacket);

  // Forward every accepted hardware frame so the UI can show actual glove and
  // Module 2 state, independent of whether a complete gesture has been signed.
  if (WS_ENABLED) {
    module3.frontendTransport.broadcast({
      type: "telemetry",
      device: normalizedPacket.device,
      seq: normalizedPacket.seq,
      mode: normalizedPacket.mode,
      emergency_mode: normalizedPacket.emergency_mode,
      gesture: "",
      flex: ["f1", "f2", "f3", "f4", "f5"].map(key =>
        normalizedPacket.flex[key] ? 100 : 0
      ),
      rawFingers: normalizedPacket.fingers,
      ultrasonic: normalizedPacket.ultrasonic,
      distance_state: normalizedPacket.distance_state,
      gesture_code: normalizedPacket.gesture_code,
      m2State: module2.getState(),
      m2LastEvent: eventResult.type,
      m2WindowCount: eventResult.readings ?? null
    });
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

  console.log(
    `[UDP ${seqStr}] from ${rinfo.address}:${rinfo.port} | ` +
    `Mode:${normalizedPacket.mode} | Fingers [${flexStr}] | ` +
    `Dist: ${distStateStr} (${rawCmStr})${gestureCodeStr} | ` +
    `M2 State: ${module2.getState()} -> Result: ${eventResult.type}`
  );

  let recognition = null;

  // Handle Module 2 Pipeline Emissions
  if (eventResult.type === "BATCH_READY") {
    const rawGestures = eventResult.batch?.gestures || [];
    console.log(`[MODULE2] Batch ready: ${rawGestures.length} gesture(s) in sequence`);

    // 1. Boundary adaptation
    const adaptedBatch = adaptBatchForModule3(rawGestures).map(gesture => ({
      ...gesture,
      // Module 2 sequence IDs restart after REST. Keep IDs unique for the
      // connected frontend so repeated emergency phrases are not deduplicated.
      sequence_id: ++module3SequenceCounter
    }));
    console.log(`[ADAPTER] Batch validated and adapted (${adaptedBatch.length} frames)`);

    // 2. Invoke Module 3 public recognition API
    console.log(`[MODULE3] Recognition started`);
    recognition = await module3.processModule2Message(adaptedBatch);
    console.log(
      `[MODULE3] Recognition completed (Status: ${recognition.status ? recognition.status.toUpperCase() : "DONE"})`
    );

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
    console.log(
      `[MODULE 2] Gesture accepted: Mode ${eventResult.gesture?.mode}, Dist: ${eventResult.gesture?.distance_state}`
    );
  }

  return { eventResult, recognition };
}

// Create UDP Socket
const server = dgram.createSocket("udp4");
let udpListening = false;

server.on("listening", () => {
  udpListening = true;
  const address = server.address();
  console.log("=================================================");
  console.log("   MUDRA Module 1 -> 2 -> 3 Ingestion Bridge     ");
  console.log(`   Status   : LISTENING                          `);
  console.log(`   Address  : ${address.address}                 `);
  console.log(`   Port     : ${address.port}                    `);
  console.log(`   Module 3 : CONNECTED (Local headless)         `);
  console.log("=================================================");
});

server.on("message", async (rawBuffer, rinfo) => {
  try {
    const rawData = JSON.parse(rawBuffer.toString("utf8"));
    await processRawPacket(rawData, rinfo);
  } catch (err) {
    console.warn(`[BRIDGE WARN] Dropping malformed packet from ${rinfo.address}:${rinfo.port}: ${err.message}`);
  }
});

server.on("error", (err) => {
  console.error("[BRIDGE SOCKET ERROR]", err.message);
  process.exitCode = 1;
  void closeBridge().catch(error => {
    console.error(`[PIPELINE SHUTDOWN ERROR] ${error.message}`);
  });
});

async function startBridge() {
  let wsAddress = null;
  if (WS_ENABLED) {
    wsAddress = await module3.startFrontendTransport();
  }
  await new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      udpListening = true;
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.bind(PORT, HOST);
  });
  const udpAddress = server.address();
  console.log(`[PIPELINE] MUDRA services ready: UDP ${udpAddress.port}, WebSocket ${wsAddress ? wsAddress.port : "disabled"}`);
  return { udp: udpAddress, websocket: wsAddress };
}

async function closeBridge() {
  if (udpListening) {
    udpListening = false;
    await new Promise(resolve => server.close(resolve));
  }
  if (module3.frontendTransport.started) {
    await module3.closeFrontendTransport();
  }
}

// Auto-bind when executed directly
if (require.main === module) {
  startBridge().catch(error => {
    console.error(`[PIPELINE STARTUP ERROR] ${error.message}`);
    process.exitCode = 1;
    void closeBridge();
  });
  process.on("message", message => {
    if (message && message.type === "shutdown") {
      closeBridge().then(() => {
        if (process.connected) process.disconnect();
      }).catch(error => {
        console.error(`[PIPELINE SHUTDOWN ERROR] ${error.message}`);
        process.exitCode = 1;
      });
    }
  });
  process.once("SIGINT", () => { void closeBridge(); });
  process.once("SIGTERM", () => { void closeBridge(); });
}

module.exports = {
  server,
  module2,
  module3,
  PORT,
  HOST,
  WS_PORT,
  WS_HOST,
  startBridge,
  closeBridge,
  quantizeDistance,
  adaptModule1Packet,
  adaptBatchForModule3,
  processRawPacket
};
