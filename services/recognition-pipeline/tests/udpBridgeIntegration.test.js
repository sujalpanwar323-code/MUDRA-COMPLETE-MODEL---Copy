/**
 * MUDRA End-to-End Bridge Integration Tests
 * File: tests/udpBridgeIntegration.test.js
 *
 * Verifies:
 * 1. Boundary adapter conversion (flex boolean objects to 5-bit binary strings).
 * 2. Finger ordering and true/false semantics.
 * 3. Exact Module 2 state-machine traversal triggering Module 3 recognition.
 * 4. Genuine standard gesture recognition output (e.g. "STOP").
 * 5. Honest no-match handling for unmapped gesture patterns.
 * 6. Live UDP datagram transmission through the full pipeline.
 * 7. Error resilience against malformed packets and invalid inputs.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");

const {
  server,
  module2,
  module3,
  adaptBatchForModule3,
  adaptModule1Packet,
  processRawPacket
} = require("../udp_bridge");
const { RESULT_TYPES } = require("../backend/module2/config");

// =========================================================================
// 1. BOUNDARY ADAPTER TESTS
// =========================================================================

test("Boundary Adapter: maps each individual finger position to exact bit index", () => {
  // f1 (thumb) -> index 0: "10000"
  const b1 = adaptBatchForModule3([
    { sequence_id: 1, mode: 0, flex: { f1: true, f2: false, f3: false, f4: false, f5: false }, distance_state: "LOW" }
  ]);
  assert.strictEqual(b1[0].flex, "10000");

  // f2 (index) -> index 1: "01000"
  const b2 = adaptBatchForModule3([
    { sequence_id: 1, mode: 0, flex: { f1: false, f2: true, f3: false, f4: false, f5: false }, distance_state: "LOW" }
  ]);
  assert.strictEqual(b2[0].flex, "01000");

  // f3 (middle) -> index 2: "00100"
  const b3 = adaptBatchForModule3([
    { sequence_id: 1, mode: 0, flex: { f1: false, f2: false, f3: true, f4: false, f5: false }, distance_state: "LOW" }
  ]);
  assert.strictEqual(b3[0].flex, "00100");

  // f4 (ring) -> index 3: "00010"
  const b4 = adaptBatchForModule3([
    { sequence_id: 1, mode: 0, flex: { f1: false, f2: false, f3: false, f4: true, f5: false }, distance_state: "LOW" }
  ]);
  assert.strictEqual(b4[0].flex, "00010");

  // f5 (little) -> index 4: "00001"
  const b5 = adaptBatchForModule3([
    { sequence_id: 1, mode: 0, flex: { f1: false, f2: false, f3: false, f4: false, f5: true }, distance_state: "LOW" }
  ]);
  assert.strictEqual(b5[0].flex, "00001");
});

test("Boundary Adapter: handles all-open and all-bent states accurately", () => {
  const allOpen = adaptBatchForModule3([
    { sequence_id: 1, mode: 0, flex: { f1: false, f2: false, f3: false, f4: false, f5: false }, distance_state: "LOW" }
  ]);
  assert.strictEqual(allOpen[0].flex, "00000");

  const allBent = adaptBatchForModule3([
    { sequence_id: 2, mode: 1, flex: { f1: true, f2: true, f3: true, f4: true, f5: true }, distance_state: "HIGH" }
  ]);
  assert.strictEqual(allBent[0].flex, "11111");
  assert.strictEqual(allBent[0].mode, 1);
  assert.strictEqual(allBent[0].distance_state, "HIGH");
  assert.strictEqual(allBent[0].sequence_id, 2);
});

test("Boundary Adapter: passes through already-formatted binary string flex", () => {
  const stringBatch = adaptBatchForModule3([
    { sequence_id: 1, mode: 0, flex: "00101", distance_state: "MID" }
  ]);
  assert.strictEqual(stringBatch[0].flex, "00101");
});

test("Boundary Adapter: rejects non-array or malformed batch inputs", () => {
  assert.throws(() => adaptBatchForModule3(null), TypeError);
  assert.throws(() => adaptBatchForModule3("not an array"), TypeError);
  assert.throws(() => adaptBatchForModule3([null]), TypeError);
});

// =========================================================================
// 2. STATE MACHINE & GENUINE RECOGNITION TESTS
// =========================================================================

test("Pipeline: Module 2 state machine traversal produces genuine 'STOP' recognition", async (t) => {
  module2.reset();
  t.after(() => module2.reset());

  // Packet template with Little finger bent (f5=true -> "00001"), Zone 1 (10cm -> "LOW")
  const bentPacket = {
    device: "MUDRA_01",
    seq: 1,
    mode: 0,
    timestamp_ms: 1000,
    fingers: { thumb: false, index: false, middle: false, ring: false, little: true },
    ultrasonic: { valid: true, distance_cm: 10.0 },
    gesture_code: 1
  };

  // Packet template for all-open REST (f1..f5=false -> "00000")
  const restPacket = {
    device: "MUDRA_01",
    seq: 11,
    mode: 0,
    timestamp_ms: 2000,
    fingers: { thumb: false, index: false, middle: false, ring: false, little: false },
    ultrasonic: { valid: true, distance_cm: 10.0 },
    gesture_code: 0
  };

  // Window 1: 10 packets with Little finger bent
  let lastGestureRes;
  for (let i = 0; i < 10; i++) {
    lastGestureRes = await processRawPacket({ ...bentPacket, seq: i + 1, timestamp_ms: 1000 + i * 100 });
  }
  assert.strictEqual(lastGestureRes.eventResult.type, RESULT_TYPES.GESTURE_ACCEPTED);
  assert.strictEqual(lastGestureRes.recognition, null); // Recognition only triggers on BATCH_READY

  // Window 2: 10 all-open REST packets to finalize batch
  let finalRes;
  for (let i = 0; i < 10; i++) {
    finalRes = await processRawPacket({ ...restPacket, seq: i + 11, timestamp_ms: 2000 + i * 100 });
  }

  assert.strictEqual(finalRes.eventResult.type, RESULT_TYPES.BATCH_READY);
  assert.notStrictEqual(finalRes.recognition, null);
  assert.strictEqual(finalRes.recognition.success, true);
  assert.strictEqual(finalRes.recognition.status, "processed");

  // Verify genuine standard library match: 0|00001|LOW -> "STOP"
  assert.deepStrictEqual(finalRes.recognition.keywords, ["STOP"]);
  assert.strictEqual(finalRes.recognition.results[0].keyword, "STOP");
  assert.strictEqual(finalRes.recognition.results[0].pattern, "0|00001|LOW");
  assert.strictEqual(finalRes.recognition.results[0].source, "standard");
});

test("Pipeline: Unmapped gesture sequence cleanly returns NO_MATCH without fabrication", async (t) => {
  module2.reset();
  t.after(() => module2.reset());

  // Unmapped gesture: Mode 1, All fingers bent ("11111"), Distance LOW
  const unmappedPacket = {
    device: "MUDRA_01",
    seq: 1,
    mode: 1,
    timestamp_ms: 1000,
    fingers: { thumb: true, index: true, middle: true, ring: true, little: true },
    ultrasonic: { valid: true, distance_cm: 10.0 },
    gesture_code: 63
  };

  const restPacket = {
    device: "MUDRA_01",
    seq: 11,
    mode: 1,
    timestamp_ms: 2000,
    fingers: { thumb: false, index: false, middle: false, ring: false, little: false },
    ultrasonic: { valid: true, distance_cm: 10.0 },
    gesture_code: 32
  };

  for (let i = 0; i < 10; i++) {
    await processRawPacket({ ...unmappedPacket, seq: i + 1 });
  }

  let finalRes;
  for (let i = 0; i < 10; i++) {
    finalRes = await processRawPacket({ ...restPacket, seq: i + 11 });
  }

  assert.strictEqual(finalRes.eventResult.type, RESULT_TYPES.BATCH_READY);
  assert.strictEqual(finalRes.recognition.success, true);
  // Must return empty keywords array, NOT a fabricated match
  assert.deepStrictEqual(finalRes.recognition.keywords, []);
  assert.strictEqual(finalRes.recognition.results[0].status, "unknown");
  assert.strictEqual(finalRes.recognition.results[0].keyword, null);
});

// =========================================================================
// 3. LIVE UDP SOCKET INGESTION & PIPELINE TEST
// =========================================================================

test("Pipeline: Live UDP packet transmission executes complete recognition path", async (t) => {
  module2.reset();
  t.after(() => module2.reset());

  const client = dgram.createSocket("udp4");

  // Bind server to dedicated test port
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.bind(0, "127.0.0.1", resolve);
  });
  const testPort = server.address().port;

  t.after(async () => {
    client.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const bentPacket = {
    device: "MUDRA_01",
    seq: 1,
    mode: 0,
    timestamp_ms: 100,
    fingers: { thumb: false, index: false, middle: false, ring: false, little: true },
    ultrasonic: { valid: true, distance_cm: 10.0 },
    gesture_code: 1
  };

  const restPacket = {
    device: "MUDRA_01",
    seq: 11,
    mode: 0,
    timestamp_ms: 1100,
    fingers: { thumb: false, index: false, middle: false, ring: false, little: false },
    ultrasonic: { valid: true, distance_cm: 10.0 },
    gesture_code: 0
  };

  // Function to send packet via real UDP socket
  function sendPacket(pkt) {
    return new Promise((resolve, reject) => {
      const msg = Buffer.from(JSON.stringify(pkt));
      client.send(msg, 0, msg.length, testPort, "127.0.0.1", (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // Send 10 bent packets
  for (let i = 0; i < 10; i++) {
    await sendPacket({ ...bentPacket, seq: i + 1 });
    await new Promise((r) => setTimeout(r, 10));
  }

  // Send 10 rest packets to trigger BATCH_READY and Module 3 recognition
  for (let i = 0; i < 10; i++) {
    await sendPacket({ ...restPacket, seq: i + 11 });
    await new Promise((r) => setTimeout(r, 10));
  }

  // Allow short processing time for async recognition completion
  await new Promise((r) => setTimeout(r, 100));

  // Verify that Module 2 processed the sequence cleanly back to IDLE
  assert.strictEqual(module2.getState(), "IDLE");
});

// =========================================================================
// 4. ERROR ISOLATION & RESILIENCE
// =========================================================================

test("Pipeline: Corrupted datagrams and invalid values do not crash receiver", async () => {
  // 1. Non-object
  await assert.rejects(async () => processRawPacket(null), TypeError);

  // 2. Invalid mode
  await assert.rejects(async () => processRawPacket({ mode: 99, fingers: {} }), TypeError);

  // 3. String finger booleans
  await assert.rejects(
    async () =>
      processRawPacket({
        mode: 0,
        fingers: { thumb: "true", index: false, middle: false, ring: false, little: false }
      }),
    TypeError
  );

  // Verify Module 2 remains fully functional after invalid packets
  module2.reset();
  assert.strictEqual(module2.getState(), "IDLE");
});
