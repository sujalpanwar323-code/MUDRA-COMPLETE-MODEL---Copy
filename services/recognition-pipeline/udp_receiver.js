/**
 * MUDRA System - Module 1 to Module 2 & Module 3 UDP Receiver Bridge
 * File: udp_receiver.js
 *
 * Description:
 * Ingests live sensor datagrams from the ESP32 (Module 1) over UDP port 5005,
 * parses and normalizes the packet schema, quantizes ultrasonic distance into
 * discrete states ("LOW" < 15cm, "MID" 15-40cm, "HIGH" > 40cm), feeds normalized
 * readings into Module 2's state machine (windowing, majority voting, REST detection),
 * and upon receiving BATCH_READY, forwards the completed gesture batch directly to
 * Module 3 for keyword recognition and logs the results to the terminal.
 *
 * Architecture Flow:
 * [ESP32 Glove (Mod 1)] -> UDP 5005 -> [udp_receiver.js] -> Module 2 -> BATCH_READY -> Module 3 -> Recognized Keywords
 */

const dgram = require("node:dgram");
const { createModule2 } = require("./backend/module2/index");
const { createModule3 } = require("./src/index");

// Network configuration
const PORT = parseInt(process.env.UDP_PORT || "5005", 10);
const HOST = process.env.UDP_HOST || "0.0.0.0";

// Initialize Module 2 and Module 3 instances
const module2 = createModule2();
const module3 = createModule3({ enableWebSocket: false });

/**
 * Quantizes continuous ultrasonic distance (cm) into discrete distance states:
 * - "LOW"  : < 15.0 cm          (Zone 1)
 * - "MID"  : 15.0 cm to 40.0 cm (Zone 2)
 * - "HIGH" : > 40.0 cm          (Zone 3, or invalid/null fallback)
 *
 * @param {object} ultrasonic Raw ultrasonic object from Module 1 packet
 * @returns {{ distance_state: "LOW" | "MID" | "HIGH", zone: 1 | 2 | 3, stable: boolean }}
 */
function quantizeDistance(ultrasonic) {
  if (
    !ultrasonic ||
    typeof ultrasonic !== "object" ||
    ultrasonic.valid === false ||
    typeof ultrasonic.distance_cm !== "number" ||
    isNaN(ultrasonic.distance_cm) ||
    ultrasonic.distance_cm <= 0
  ) {
    // Graceful fallback to "HIGH" (neutral / rest zone)
    return {
      distance_state: "HIGH",
      zone: 3,
      stable: true
    };
  }

  const cm = ultrasonic.distance_cm;
  if (cm < 15.0) {
    return { distance_state: "LOW", zone: 1, stable: true };
  } else if (cm <= 40.0) {
    return { distance_state: "MID", zone: 2, stable: true };
  } else {
    return { distance_state: "HIGH", zone: 3, stable: true };
  }
}

/**
 * Adapts raw Module 1 ESP32 JSON payload into Module 2 input frame schema.
 *
 * @param {object} raw Parsed JSON packet from ESP32
 * @returns {object} Module 2 compatible input packet
 */
function adaptModule1Packet(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Raw packet must be a non-null JSON object.");
  }

  const fingers = raw.fingers || {};
  const ultrasonic = raw.ultrasonic || {};

  // 1. Quantize ultrasonic distance
  const { distance_state, zone, stable } = quantizeDistance(ultrasonic);

  // 2. Map finger states to booleans
  const thumb = Boolean(fingers.thumb ?? fingers.f1);
  const index = Boolean(fingers.index ?? fingers.f2);
  const middle = Boolean(fingers.middle ?? fingers.f3);
  const ring = Boolean(fingers.ring ?? fingers.f4);
  const little = Boolean(fingers.little ?? fingers.f5);

  const mode =
    typeof raw.mode === "number" && (raw.mode === 0 || raw.mode === 1)
      ? raw.mode
      : 0;

  return {
    device: typeof raw.device === "string" ? raw.device : "MUDRA_01",
    seq: typeof raw.seq === "number" ? raw.seq : null,
    sequence_id: typeof raw.seq === "number" ? raw.seq : Date.now(),
    mode,
    // Module 2 validate.js expects named finger properties:
    fingers: {
      thumb,
      index,
      middle,
      ring,
      little
    },
    // Object-based booleans f1..f5 for downstream adapters:
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
      distance_cm:
        typeof ultrasonic.distance_cm === "number" ? ultrasonic.distance_cm : null
    },
    distance_state
  };
}

/**
 * Boundary Adapter:
 * Converts Module 2 gesture batch output schema into Module 3's expected 5-char binary string format.
 *
 * @param {Array<object>} gestures Array of gestures from Module 2 result.batch.gestures
 * @returns {Array<object>}
 */
function adaptGesturesForModule3(gestures) {
  if (!Array.isArray(gestures)) {
    return gestures;
  }
  return gestures.map((g) => {
    let flex = g.flex;
    if (typeof flex === "object" && flex !== null) {
      const f1 = flex.f1 ? "1" : "0";
      const f2 = flex.f2 ? "1" : "0";
      const f3 = flex.f3 ? "1" : "0";
      const f4 = flex.f4 ? "1" : "0";
      const f5 = flex.f5 ? "1" : "0";
      flex = `${f1}${f2}${f3}${f4}${f5}`;
    }
    return {
      sequence_id: g.sequence_id,
      mode: g.mode,
      flex,
      distance_state: g.distance_state
    };
  });
}

// Create UDP Server Socket
const server = dgram.createSocket("udp4");

server.on("listening", () => {
  const address = server.address();
  console.log("=======================================================");
  console.log("   MUDRA Module 1 -> Module 2 & 3 Receiver Bridge     ");
  console.log(`   Listening on UDP : ${address.address}:${address.port}           `);
  console.log("   Status           : READY FOR SENSOR PACKETS        ");
  console.log("=======================================================\n");
});

server.on("message", async (rawBuffer, rinfo) => {
  try {
    const rawData = JSON.parse(rawBuffer.toString("utf8"));
    const normalizedPacket = adaptModule1Packet(rawData);

    // Feed normalized reading into Module 2 state machine
    const eventResult = module2.processReading(normalizedPacket);

    // Format packet log
    const seqStr = normalizedPacket.seq !== null ? `#${normalizedPacket.seq}` : "N/A";
    const flexStr =
      `T:${normalizedPacket.fingers.thumb ? 1 : 0} ` +
      `I:${normalizedPacket.fingers.index ? 1 : 0} ` +
      `M:${normalizedPacket.fingers.middle ? 1 : 0} ` +
      `R:${normalizedPacket.fingers.ring ? 1 : 0} ` +
      `L:${normalizedPacket.fingers.little ? 1 : 0}`;
    const rawCmStr =
      rawData.ultrasonic && typeof rawData.ultrasonic.distance_cm === "number"
        ? `${rawData.ultrasonic.distance_cm.toFixed(1)}cm`
        : "N/A";

    console.log(
      `[UDP ${seqStr}] from ${rinfo.address}:${rinfo.port} | ` +
      `Mode:${normalizedPacket.mode} | Flex [${flexStr}] | ` +
      `Dist: ${normalizedPacket.distance_state} (${rawCmStr}) | ` +
      `M2 State: ${module2.getState()} -> Result: ${eventResult.type}`
    );

    // Handle Module 2 Pipeline Emissions
    if (eventResult && eventResult.type === "BATCH_READY") {
      const rawGestures = eventResult.batch?.gestures || [];
      console.log("\n=======================================================");
      console.log(">>> MODULE 2 EVENT: BATCH_READY (Strict REST Detected) <<<");
      console.log(`Captured Gesture Frames: ${rawGestures.length}`);

      // Forward directly to Module 3
      const module3Input = adaptGesturesForModule3(rawGestures);
      const recognition = await module3.processModule2Message(module3Input);

      console.log(`>>> MODULE 3 STATUS: ${recognition.status ? recognition.status.toUpperCase() : "DONE"} <<<`);
      console.log("Recognized Keyword Sequence:");

      if (recognition.results && recognition.results.length > 0) {
        recognition.results.forEach((item, idx) => {
          const seq = item.sequence_id !== undefined ? item.sequence_id : idx + 1;
          const kw = item.keyword || "[NO MATCH]";
          const pattern = item.pattern || "N/A";
          console.log(`  Word #${seq}: "${kw}" (Pattern: ${pattern}, Status: ${item.status})`);
        });
      } else if (recognition.keywords && recognition.keywords.length > 0) {
        recognition.keywords.forEach((kw, idx) => {
          console.log(`  Word #${idx + 1}: "${kw}"`);
        });
      } else {
        console.log("  (No keywords recognized for current gesture sequence)");
      }
      console.log("=======================================================\n");
    } else if (eventResult && eventResult.type === "GESTURE_ACCEPTED") {
      console.log(
        `[MODULE 2] Gesture Accepted -> Mode ${eventResult.gesture?.mode}, Distance: ${eventResult.gesture?.distance_state}`
      );
    } else if (eventResult && eventResult.type === "WINDOW_REJECTED") {
      console.log(
        `[MODULE 2 WARN] Window Rejected -> ${eventResult.reason} (${eventResult.details || ""})`
      );
    } else if (eventResult && eventResult.type === "EMPTY_SIGNING_SEQUENCE") {
      console.log("[MODULE 2] Empty signing sequence detected. State reset to IDLE.");
    }
  } catch (err) {
    console.warn(`[BRIDGE WARN] Dropping malformed UDP packet: ${err.message}`);
  }
});

server.on("error", (err) => {
  console.error("[BRIDGE SOCKET ERROR]", err.message);
  server.close();
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
  adaptGesturesForModule3
};
