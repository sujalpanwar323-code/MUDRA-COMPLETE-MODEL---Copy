/**
 * MUDRA Module 2 - Automated Test Suite
 *
 * Verifies all 21 test scenarios defined in Section 12 of
 * MUDRA_Module2_Architecture.md using Node.js built-in test runner.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createModule2 } = require("../backend/module2/index");
const {
  RESULT_TYPES,
  REASON_CODES,
  STATE_IDLE,
  STATE_COLLECTING
} = require("../backend/module2/config");

/**
 * Helper to construct a valid packet with optional overrides.
 */
function makePacket(overrides = {}) {
  const base = {
    mode: 0,
    fingers: {
      thumb: false,
      index: false,
      middle: false,
      ring: false,
      little: false
    },
    ultrasonic: {
      zone: 2,
      stable: true
    }
  };

  return {
    ...base,
    ...overrides,
    fingers: {
      ...base.fingers,
      ...(overrides.fingers || {})
    },
    ultrasonic: {
      ...base.ultrasonic,
      ...(overrides.ultrasonic || {})
    }
  };
}

describe("MUDRA Module 2 Specification Compliance", () => {
  // 1. Idle ignores all-open readings
  it("1. Idle ignores all-open readings", () => {
    const module2 = createModule2();
    for (let i = 0; i < 5; i++) {
      const res = module2.processReading(makePacket());
      assert.strictEqual(res.type, RESULT_TYPES.WAITING);
    }
    assert.strictEqual(module2.getState(), STATE_IDLE);
  });

  // 2. First bent packet starts collection and is included
  it("2. First bent packet starts collection and is included", () => {
    const module2 = createModule2();
    const idleRes = module2.processReading(makePacket());
    assert.strictEqual(idleRes.type, RESULT_TYPES.WAITING);

    const bentPacket = makePacket({ fingers: { index: true } });
    const startRes = module2.processReading(bentPacket);
    assert.strictEqual(startRes.type, RESULT_TYPES.WINDOW_COLLECTING);
    assert.strictEqual(startRes.readings, 1);
    assert.strictEqual(module2.getState(), STATE_COLLECTING);
  });

  // 3. Exactly ten packets complete a window
  it("3. Exactly ten packets complete a window", () => {
    const module2 = createModule2();
    const bent = makePacket({ fingers: { thumb: true } });

    for (let i = 1; i <= 9; i++) {
      const res = module2.processReading(bent);
      assert.strictEqual(res.type, RESULT_TYPES.WINDOW_COLLECTING);
      assert.strictEqual(res.readings, i);
    }

    const tenthRes = module2.processReading(bent);
    assert.strictEqual(tenthRes.type, RESULT_TYPES.GESTURE_ACCEPTED);
    assert.deepStrictEqual(tenthRes.gesture.flex, {
      f1: true,
      f2: false,
      f3: false,
      f4: false,
      f5: false
    });
  });

  // 4. Windows are non-overlapping
  it("4. Windows are non-overlapping", () => {
    const module2 = createModule2();
    const bent = makePacket({ fingers: { thumb: true } });

    // Window 1: packets 1..10
    for (let i = 1; i <= 9; i++) {
      module2.processReading(bent);
    }
    const win1End = module2.processReading(bent);
    assert.strictEqual(win1End.type, RESULT_TYPES.GESTURE_ACCEPTED);

    // Window 2: packet 11 is reading 1 of window 2
    const packet11Res = module2.processReading(bent);
    assert.strictEqual(packet11Res.type, RESULT_TYPES.WINDOW_COLLECTING);
    assert.strictEqual(packet11Res.readings, 1);

    for (let i = 2; i <= 9; i++) {
      module2.processReading(bent);
    }
    const win2End = module2.processReading(bent);
    assert.strictEqual(win2End.type, RESULT_TYPES.GESTURE_ACCEPTED);
  });

  // 5. Ten all-open packets produce REST after collection has started
  it("5. Ten all-open packets produce REST after collection has started", () => {
    const module2 = createModule2();
    const bent = makePacket({ fingers: { thumb: true } });

    // Window 1: valid gesture
    for (let i = 0; i < 10; i++) {
      module2.processReading(bent);
    }

    // Window 2: 10 all-open packets
    for (let i = 1; i <= 9; i++) {
      const res = module2.processReading(makePacket());
      assert.strictEqual(res.type, RESULT_TYPES.WINDOW_COLLECTING);
      assert.strictEqual(res.readings, i);
    }

    const restRes = module2.processReading(makePacket());
    assert.strictEqual(restRes.type, RESULT_TYPES.BATCH_READY);
    assert.strictEqual(restRes.batch.type, "gesture_batch");
    assert.strictEqual(restRes.batch.gestures.length, 1);
    assert.strictEqual(restRes.batch.gestures[0].sequence_id, 1);
    assert.deepStrictEqual(restRes.batch.gestures[0].flex, {
      f1: true,
      f2: false,
      f3: false,
      f4: false,
      f5: false
    });
    assert.strictEqual(module2.getState(), STATE_IDLE);
  });

  // 6. Nine rest packets plus one bent packet are not REST
  it("6. Nine rest packets plus one bent packet are not REST", () => {
    const module2 = createModule2();

    // Trigger collection with 1 bent packet
    const bent = makePacket({ fingers: { thumb: true } });
    module2.processReading(bent);

    // 9 all-open packets
    for (let i = 2; i <= 9; i++) {
      module2.processReading(makePacket());
    }
    // 10th packet is open
    const tenthRes = module2.processReading(makePacket());

    // Because packet 1 was bent, this was NOT a 10/10 rest window!
    // Thumb: 1 true, 9 false -> bit 0
    // Others: 0 true, 10 false -> bits 0
    // Flex: all false -> accepted gesture, NOT batch_ready!
    assert.strictEqual(tenthRes.type, RESULT_TYPES.GESTURE_ACCEPTED);
    assert.deepStrictEqual(tenthRes.gesture.flex, {
      f1: false,
      f2: false,
      f3: false,
      f4: false,
      f5: false
    });
    assert.strictEqual(module2.getState(), STATE_COLLECTING);
  });

  // 7. Each finger's 6–4 vote is accepted
  it("7. Each finger's 6-4 vote is accepted", () => {
    const module2 = createModule2();

    // 6 packets with: thumb=true, index=false, middle=true, ring=true, little=false
    const p1 = makePacket({
      fingers: { thumb: true, index: false, middle: true, ring: true, little: false }
    });
    // 4 packets with: thumb=false, index=true, middle=false, ring=false, little=true
    const p2 = makePacket({
      fingers: { thumb: false, index: true, middle: false, ring: false, little: true }
    });

    for (let i = 0; i < 6; i++) module2.processReading(p1);
    let lastRes;
    for (let i = 0; i < 4; i++) lastRes = module2.processReading(p2);

    assert.strictEqual(lastRes.type, RESULT_TYPES.GESTURE_ACCEPTED);
    // thumb (6 true) -> f1: true
    // index (6 false) -> f2: false
    // middle (6 true) -> f3: true
    // ring (6 true) -> f4: true
    // little (6 false) -> f5: false
    assert.deepStrictEqual(lastRes.gesture.flex, {
      f1: true,
      f2: false,
      f3: true,
      f4: true,
      f5: false
    });
  });

  // 8. A 5–5 finger vote rejects the window
  it("8. A 5-5 finger vote rejects the window", () => {
    const module2 = createModule2();

    // Thumb has 5 true, 5 false; other fingers 10 true
    const pTrue = makePacket({
      fingers: { thumb: true, index: true, middle: true, ring: true, little: true }
    });
    const pFalse = makePacket({
      fingers: { thumb: false, index: true, middle: true, ring: true, little: true }
    });

    for (let i = 0; i < 5; i++) module2.processReading(pTrue);
    let lastRes;
    for (let i = 0; i < 5; i++) lastRes = module2.processReading(pFalse);

    assert.strictEqual(lastRes.type, RESULT_TYPES.WINDOW_REJECTED);
    assert.strictEqual(lastRes.reason, REASON_CODES.FINGER_VOTE_TIE);
  });

  // 9. Bit order is thumb/index/middle/ring/little
  it("9. Bit order is thumb/index/middle/ring/little", () => {
    const module2 = createModule2();
    const packet = makePacket({
      fingers: { thumb: true, index: true, middle: false, ring: false, little: false }
    });

    let res;
    for (let i = 0; i < 10; i++) {
      res = module2.processReading(packet);
    }
    assert.strictEqual(res.type, RESULT_TYPES.GESTURE_ACCEPTED);
    assert.deepStrictEqual(res.gesture.flex, {
      f1: true,
      f2: true,
      f3: false,
      f4: false,
      f5: false
    });

    // Another order test: thumb=false, index=false, middle=true, ring=false, little=true
    const p2 = makePacket({
      fingers: { thumb: false, index: false, middle: true, ring: false, little: true }
    });
    for (let i = 0; i < 10; i++) {
      res = module2.processReading(p2);
    }
    assert.strictEqual(res.type, RESULT_TYPES.GESTURE_ACCEPTED);
    assert.deepStrictEqual(res.gesture.flex, {
      f1: false,
      f2: false,
      f3: true,
      f4: false,
      f5: true
    });
  });

  // 10. Zone 1 maps to LOW; zone 2 to MID; zone 3 to HIGH
  it("10. Zone 1 maps to LOW; zone 2 to MID; zone 3 to HIGH", () => {
    const zones = [
      { zone: 1, expected: "LOW" },
      { zone: 2, expected: "MID" },
      { zone: 3, expected: "HIGH" }
    ];

    for (const { zone, expected } of zones) {
      const module2 = createModule2();
      const packet = makePacket({
        fingers: { thumb: true },
        ultrasonic: { zone, stable: true }
      });

      let res;
      for (let i = 0; i < 10; i++) {
        res = module2.processReading(packet);
      }
      assert.strictEqual(res.type, RESULT_TYPES.GESTURE_ACCEPTED);
      assert.strictEqual(res.gesture.distance_state, expected);
    }
  });

  // 11. Unstable readings do not vote on distance
  it("11. Unstable readings do not vote on distance", () => {
    const module2 = createModule2();

    // 6 stable readings for zone 1
    const pStable = makePacket({
      fingers: { thumb: true },
      ultrasonic: { zone: 1, stable: true }
    });
    // 4 unstable readings with zone 3
    const pUnstable = makePacket({
      fingers: { thumb: true },
      ultrasonic: { zone: 3, stable: false }
    });

    for (let i = 0; i < 6; i++) module2.processReading(pStable);
    let res;
    for (let i = 0; i < 4; i++) res = module2.processReading(pUnstable);

    assert.strictEqual(res.type, RESULT_TYPES.GESTURE_ACCEPTED);
    assert.strictEqual(res.gesture.distance_state, "LOW");
  });

  // 12. Fewer than six stable votes reject the window
  it("12. Fewer than six stable votes reject the window", () => {
    const module2 = createModule2();

    // 5 stable readings
    const pStable = makePacket({
      fingers: { thumb: true },
      ultrasonic: { zone: 2, stable: true }
    });
    // 5 unstable readings
    const pUnstable = makePacket({
      fingers: { thumb: true },
      ultrasonic: { zone: 2, stable: false }
    });

    for (let i = 0; i < 5; i++) module2.processReading(pStable);
    let res;
    for (let i = 0; i < 5; i++) res = module2.processReading(pUnstable);

    assert.strictEqual(res.type, RESULT_TYPES.WINDOW_REJECTED);
    assert.strictEqual(res.reason, REASON_CODES.DISTANCE_NO_MAJORITY);
  });

  // 13. No zone reaching six votes rejects the window
  it("13. No zone reaching six votes rejects the window", () => {
    const module2 = createModule2();

    // 5 stable zone 1 readings
    const p1 = makePacket({
      fingers: { thumb: true },
      ultrasonic: { zone: 1, stable: true }
    });
    // 5 stable zone 2 readings
    const p2 = makePacket({
      fingers: { thumb: true },
      ultrasonic: { zone: 2, stable: true }
    });

    for (let i = 0; i < 5; i++) module2.processReading(p1);
    let res;
    for (let i = 0; i < 5; i++) res = module2.processReading(p2);

    assert.strictEqual(res.type, RESULT_TYPES.WINDOW_REJECTED);
    assert.strictEqual(res.reason, REASON_CODES.DISTANCE_NO_MAJORITY);
  });

  // 14. Both modes work when consistent
  it("14. Both modes work when consistent", () => {
    for (const mode of [0, 1]) {
      const module2 = createModule2();
      const packet = makePacket({
        mode,
        fingers: { index: true }
      });

      let res;
      for (let i = 0; i < 10; i++) {
        res = module2.processReading(packet);
      }
      assert.strictEqual(res.type, RESULT_TYPES.GESTURE_ACCEPTED);
      assert.strictEqual(res.gesture.mode, mode);
    }
  });

  // 15. A mode change rejects the interrupted window
  it("15. A mode change rejects the interrupted window", () => {
    const module2 = createModule2();
    const pMode0 = makePacket({ mode: 0, fingers: { index: true } });
    const pMode1 = makePacket({ mode: 1, fingers: { index: true } });

    // 4 packets of mode 0
    for (let i = 0; i < 4; i++) {
      module2.processReading(pMode0);
    }

    // Packet 5 arrives with mode 1
    const res = module2.processReading(pMode1);
    assert.strictEqual(res.type, RESULT_TYPES.WINDOW_REJECTED);
    assert.strictEqual(res.reason, REASON_CODES.MODE_CHANGED);
  });

  // 16. First packet with the new mode starts the next window
  it("16. First packet with the new mode starts the next window", () => {
    const module2 = createModule2();
    const pMode0 = makePacket({ mode: 0, fingers: { thumb: true } });
    const pMode1 = makePacket({ mode: 1, fingers: { thumb: true } });

    // 4 packets of mode 0
    for (let i = 0; i < 4; i++) {
      module2.processReading(pMode0);
    }
    // Mode transition packet (packet 1 of fresh window)
    const transitionRes = module2.processReading(pMode1);
    assert.strictEqual(transitionRes.type, RESULT_TYPES.WINDOW_REJECTED);
    assert.strictEqual(transitionRes.reason, REASON_CODES.MODE_CHANGED);

    // Send remaining 9 packets of mode 1 to complete the 10-packet window
    let res;
    for (let i = 0; i < 9; i++) {
      res = module2.processReading(pMode1);
    }

    assert.strictEqual(res.type, RESULT_TYPES.GESTURE_ACCEPTED);
    assert.strictEqual(res.gesture.mode, 1);
    assert.deepStrictEqual(res.gesture.flex, {
      f1: true,
      f2: false,
      f3: false,
      f4: false,
      f5: false
    });
  });

  // 17. Rejected windows preserve earlier accepted gestures
  it("17. Rejected windows preserve earlier accepted gestures", () => {
    const module2 = createModule2();

    // Window 1: valid gesture
    const valid = makePacket({ fingers: { thumb: true } });
    for (let i = 0; i < 10; i++) {
      module2.processReading(valid);
    }
    assert.strictEqual(module2.getPendingGestures().length, 1);

    // Window 2: tie vote on index finger (rejected)
    const pTie1 = makePacket({ fingers: { index: true } });
    const pTie2 = makePacket({ fingers: { index: false } });
    for (let i = 0; i < 5; i++) module2.processReading(pTie1);
    for (let i = 0; i < 5; i++) module2.processReading(pTie2);

    // Pending gestures still retained!
    assert.strictEqual(module2.getPendingGestures().length, 1);

    // Window 3: strict REST flushes batch containing Window 1 gesture
    let restRes;
    for (let i = 0; i < 10; i++) {
      restRes = module2.processReading(makePacket());
    }
    assert.strictEqual(restRes.type, RESULT_TYPES.BATCH_READY);
    assert.strictEqual(restRes.batch.gestures.length, 1);
    assert.strictEqual(restRes.batch.gestures[0].sequence_id, 1);
    assert.deepStrictEqual(restRes.batch.gestures[0].flex, {
      f1: true,
      f2: false,
      f3: false,
      f4: false,
      f5: false
    });
  });

  // 18. REST emits accumulated gestures in order
  it("18. REST emits accumulated gestures in order", () => {
    const module2 = createModule2();

    // Window 1: thumb bent (mode 0)
    const g1 = makePacket({ mode: 0, fingers: { thumb: true } });
    for (let i = 0; i < 10; i++) module2.processReading(g1);

    // Window 2: index bent (mode 0)
    const g2 = makePacket({ mode: 0, fingers: { index: true } });
    for (let i = 0; i < 10; i++) module2.processReading(g2);

    // Window 3: strict REST
    let res;
    for (let i = 0; i < 10; i++) {
      res = module2.processReading(makePacket());
    }

    assert.strictEqual(res.type, RESULT_TYPES.BATCH_READY);
    assert.strictEqual(res.batch.gestures.length, 2);
    assert.strictEqual(res.batch.gestures[0].sequence_id, 1);
    assert.deepStrictEqual(res.batch.gestures[0].flex, {
      f1: true,
      f2: false,
      f3: false,
      f4: false,
      f5: false
    });
    assert.strictEqual(res.batch.gestures[1].sequence_id, 2);
    assert.deepStrictEqual(res.batch.gestures[1].flex, {
      f1: false,
      f2: true,
      f3: false,
      f4: false,
      f5: false
    });
  });

  // 19. Empty REST sequence does not emit an empty batch
  it("19. Empty REST sequence does not emit an empty batch", () => {
    const module2 = createModule2();

    // Window 1: rejected due to unstable distance
    const pUnstable = makePacket({
      fingers: { thumb: true },
      ultrasonic: { zone: 2, stable: false }
    });
    for (let i = 0; i < 10; i++) {
      module2.processReading(pUnstable);
    }
    assert.strictEqual(module2.getPendingGestures().length, 0);

    // Window 2: strict REST
    let res;
    for (let i = 0; i < 10; i++) {
      res = module2.processReading(makePacket());
    }

    assert.strictEqual(res.type, RESULT_TYPES.EMPTY_SIGNING_SEQUENCE);
    assert.strictEqual(module2.getState(), STATE_IDLE);
  });

  // 20. Explicit reset clears internal state
  it("20. Explicit reset clears internal state", () => {
    const module2 = createModule2();
    const bent = makePacket({ fingers: { thumb: true } });

    // Complete Window 1
    for (let i = 0; i < 10; i++) module2.processReading(bent);
    assert.strictEqual(module2.getPendingGestures().length, 1);

    // Partially fill Window 2
    module2.processReading(bent);
    module2.processReading(bent);

    // Reset
    module2.reset();
    assert.strictEqual(module2.getState(), STATE_IDLE);
    assert.strictEqual(module2.getPendingGestures().length, 0);

    // Next all-open packet is treated as IDLE WAITING
    const res = module2.processReading(makePacket());
    assert.strictEqual(res.type, RESULT_TYPES.WAITING);
  });

  // 21. Malformed packets do not create fabricated values
  it("21. Malformed packets do not create fabricated values", () => {
    const malformedPackets = [
      null,
      {},
      { mode: "0", fingers: { thumb: true }, ultrasonic: { zone: 2, stable: true } },
      makePacket({ mode: 2 }), // invalid mode
      makePacket({ fingers: { thumb: "true" } }), // string boolean
      makePacket({ fingers: { thumb: 1 } }), // integer instead of boolean
      makePacket({ ultrasonic: { zone: 5, stable: true } }), // invalid zone
      makePacket({ ultrasonic: { stable: "true" } }) // string stable
    ];

    for (const badPacket of malformedPackets) {
      const module2 = createModule2();
      // Start window with valid bent packet
      module2.processReading(makePacket({ fingers: { thumb: true } }));

      // Send bad packet mid-window
      module2.processReading(badPacket);

      // Fill remainder with valid packets
      let lastRes;
      for (let i = 0; i < 8; i++) {
        lastRes = module2.processReading(makePacket({ fingers: { thumb: true } }));
      }

      // Must be rejected, never fabricated
      assert.strictEqual(lastRes.type, RESULT_TYPES.WINDOW_REJECTED);
      assert.ok(
        [
          REASON_CODES.INVALID_PACKET,
          REASON_CODES.INVALID_MODE,
          REASON_CODES.INVALID_STABLE_ZONE
        ].includes(lastRes.reason)
      );
    }
  });

  // 22. EMPTY_SIGNING_SEQUENCE entirely clears sequence counters and window buffers
  it("22. EMPTY_SIGNING_SEQUENCE entirely clears sequence counters and window buffers", () => {
    const module2 = createModule2();
    const bent = makePacket({ fingers: { thumb: true } });

    // Incomplete/rejected window
    for (let i = 0; i < 5; i++) module2.processReading(bent);

    // Followed by REST window -> triggers EMPTY_SIGNING_SEQUENCE
    let emptyRes;
    for (let i = 0; i < 10; i++) {
      emptyRes = module2.processReading(makePacket());
    }
    assert.strictEqual(emptyRes.type, RESULT_TYPES.EMPTY_SIGNING_SEQUENCE);
    assert.strictEqual(module2.getState(), STATE_IDLE);
    assert.strictEqual(module2.getPendingGestures().length, 0);
    assert.strictEqual(module2.getSequenceCounter(), 0);

    // Subsequent fresh gesture gets sequence_id 1 with zero data bleeding
    for (let i = 0; i < 10; i++) module2.processReading(bent);
    assert.strictEqual(module2.getPendingGestures().length, 1);
    assert.strictEqual(module2.getPendingGestures()[0].sequence_id, 1);
  });

  // 23. Rapid mode switches across consecutive packets cleanly re-index window counter without stalling
  it("23. Rapid mode switches across consecutive packets cleanly re-index window counter without stalling", () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);

    try {
      const module2 = createModule2();
      const pMode0 = makePacket({ mode: 0, fingers: { index: true } });
      const pMode1 = makePacket({ mode: 1, fingers: { index: true } });

      // Start collecting mode 0
      module2.processReading(pMode0);

      // Rapid consecutive switches 0 -> 1 -> 0 -> 1
      const res1 = module2.processReading(pMode1);
      assert.strictEqual(res1.type, RESULT_TYPES.WINDOW_REJECTED);
      assert.strictEqual(res1.reason, REASON_CODES.MODE_CHANGED);

      const res2 = module2.processReading(pMode0);
      assert.strictEqual(res2.type, RESULT_TYPES.WINDOW_REJECTED);
      assert.strictEqual(res2.reason, REASON_CODES.MODE_CHANGED);

      const res3 = module2.processReading(pMode1);
      assert.strictEqual(res3.type, RESULT_TYPES.WINDOW_REJECTED);
      assert.strictEqual(res3.reason, REASON_CODES.MODE_CHANGED);

      // Verify diagnostic warnings were recorded
      assert.ok(warnings.length >= 3);
      assert.ok(warnings.some(w => w.includes("Rapid mode switch detected")));

      // Pipeline continues stably: 9 more packets of mode 1 completes the window cleanly
      let acceptedRes;
      for (let i = 0; i < 9; i++) {
        acceptedRes = module2.processReading(pMode1);
      }
      assert.strictEqual(acceptedRes.type, RESULT_TYPES.GESTURE_ACCEPTED);
      assert.strictEqual(acceptedRes.gesture.mode, 1);
    } finally {
      console.warn = originalWarn;
    }
  });
});
