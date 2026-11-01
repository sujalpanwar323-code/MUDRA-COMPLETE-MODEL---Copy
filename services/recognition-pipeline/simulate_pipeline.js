/**
 * MUDRA End-to-End Pipeline Simulator
 * Feeds Module 1 packet streams -> Module 2 -> Module 3 -> Keyword Output
 *
 * Architecture & Integration Pipeline:
 * [Module 1 Packets] -> Module 2 (Windowing & Normalization) -> BATCH_READY
 *   -> Boundary Adapter (Flex schema alignment) -> Module 3 (Recognition) -> Keyword Output
 */

const fs = require("fs");
const path = require("path");
const { createModule2 } = require("./backend/module2/index");
const { createModule3 } = require("./src/index");

// Load mock dataset (e.g. 110 packets)
const defaultMockPath = path.join(__dirname, "mock_packets.json");
const mockDataPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : defaultMockPath;

if (!fs.existsSync(mockDataPath)) {
  console.error(`[ERROR] Mock packets file not found at: ${mockDataPath}`);
  process.exit(1);
}

const packets = JSON.parse(fs.readFileSync(mockDataPath, "utf8"));

/**
 * Boundary Adapter:
 * Converts Module 2 output schema to Module 3 input requirements.
 * Specifically converts object-based flex ({ f1: true, ... }) to 5-char binary string ("10000")
 * if required by Module 3's input adapter, while preserving existing string flex.
 *
 * @param {Array<object>} gestures
 * @returns {Array<object>}
 */
function adaptGesturesForModule3(gestures) {
  if (!Array.isArray(gestures)) {
    return gestures;
  }
  return gestures.map((gesture) => {
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
      sequence_id: gesture.sequence_id,
      mode: gesture.mode,
      flex,
      distance_state: gesture.distance_state
    };
  });
}

/**
 * Runs the end-to-end simulation.
 *
 * @param {Array<object>} [customPackets] Optional override packet array
 * @returns {Promise<{ batchCount: number, batches: Array<object> }>}
 */
async function runSimulation(customPackets) {
  const stream = customPackets || packets;
  const module2 = createModule2();
  const module3 = createModule3({ enableWebSocket: false }); // Run headless for CLI simulation

  console.log(`====================================================`);
  console.log(`  MUDRA PIPELINE SIMULATOR`);
  console.log(`  Loaded ${stream.length} packets from dataset.`);
  console.log(`====================================================\n`);

  let batchCount = 0;
  const recordedBatches = [];

  try {
    for (let i = 0; i < stream.length; i++) {
      const packet = stream[i];
      const result = module2.processReading(packet);

      if (result.type === "GESTURE_ACCEPTED") {
        console.log(
          `[Packet #${i + 1}] Gesture Accepted -> Mode ${result.gesture.mode}, Distance: ${result.gesture.distance_state}`
        );
      } else if (result.type === "WINDOW_REJECTED") {
        console.log(
          `[Packet #${i + 1}] Window Rejected -> ${result.reason} (${result.details})`
        );
      } else if (result.type === "BATCH_READY") {
        batchCount++;
        console.log(`\n----------------------------------------------------`);
        console.log(`>>> BATCH READY #${batchCount} (Strict REST Detected) <<<`);
        console.log(
          `Extracted ${result.batch.gestures.length} gestures from Module 2.`
        );

        // Boundary Adapter: unwrap and format for Module 3
        const gestures = adaptGesturesForModule3(result.batch.gestures);

        // Process through Module 3
        const recognition = await module3.processModule2Message(gestures);

        console.log(`Module 3 Recognition Status: ${recognition.status}`);
        console.log(`Recognized Keyword Sequence:`);

        const keywordItems = (recognition.results && recognition.results.length > 0)
          ? recognition.results
          : (recognition.keywords || []).map((k, idx) => ({ sequence_id: idx + 1, keyword: k }));

        keywordItems.forEach((item, idx) => {
          const seq = item.sequence_id !== undefined ? item.sequence_id : idx + 1;
          const kw = item.keyword !== undefined ? item.keyword : item;
          const conf = item.confidence || "N/A";
          console.log(`  Word #${seq}: "${kw}" (Confidence: ${conf})`);
        });

        console.log(`----------------------------------------------------\n`);

        recordedBatches.push({
          batchNumber: batchCount,
          gestures,
          recognition
        });
      } else if (result.type === "EMPTY_SIGNING_SEQUENCE") {
        console.log(
          `[Packet #${i + 1}] Empty Signing Sequence -> Strict REST detected with 0 valid gestures.`
        );
      }
    }

    console.log(
      `\nSimulation Complete. Processed ${stream.length} packets, generated ${batchCount} gesture batch(es).`
    );

    return {
      batchCount,
      batches: recordedBatches
    };
  } finally {
    // Session Cleanup Discipline: Ensure state machine reset
    module2.reset();
  }
}

if (require.main === module) {
  runSimulation().catch((err) => {
    console.error("[FATAL] Pipeline simulation failed:", err);
    process.exit(1);
  });
}

module.exports = {
  runSimulation,
  adaptGesturesForModule3
};
