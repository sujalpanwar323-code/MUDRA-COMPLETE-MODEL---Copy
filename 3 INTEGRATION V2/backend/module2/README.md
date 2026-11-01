# MUDRA — Module 2: Sensor Window Processing & Normalization

## 1. Overview & Purpose

Module 2 is a stateful JavaScript processing component within the MUDRA sign language translation system. It sits between transport ingestion (which receives JSON packets from the ESP32 / Module 1) and gesture library lookup (Module 3).

Module 2 is a **pure function-based component**, not a network server or daemon. It performs no socket operations, no UDP reception, and no direct calls to Module 3. It operates on an isolated instance model via `createModule2()`.

## 2. Boundaries & Non-Responsibilities

- **No Network / UDP:** Packet transport is managed exclusively by the backend orchestrator.
- **No Signal Filtering / Debounce:** Raw sensor filtering, debounce, and ultrasonic distance thresholding are finalized on hardware (Module 1).
- **No Gesture Lookup:** Mapping `(mode, flex, distance_state)` to keywords/IDs belongs strictly to Module 3.
- **No Speculative Types or Coercions:** Missing fields or wrong types are never coerced; invalid windows are rejected cleanly.

## 3. Data Contracts

### 3.1 Input Packet (Module 1 Schema)

Each call to `processReading(packet)` accepts one packet:

```json
{
  "mode": 1,
  "fingers": {
    "thumb": true,
    "index": true,
    "middle": false,
    "ring": false,
    "little": false
  },
  "ultrasonic": {
    "zone": 2,
    "stable": true
  }
}
```

- `mode`: Integer `0` or `1`.
- `fingers`: Five required boolean properties (`thumb`, `index`, `middle`, `ring`, `little`).
- `ultrasonic.zone`: Integer `1` (LOW), `2` (MID), or `3` (HIGH).
- `ultrasonic.stable`: Strict boolean. Only stable readings participate in distance voting.

### 3.2 Output Batch (`BATCH_READY`)

Emitted only when a strict REST window occurs:

```json
{
  "type": "gesture_batch",
  "gestures": [
    {
      "sequence_id": 1,
      "mode": 0,
      "flex": { "f1": false, "f2": true, "f3": false, "f4": true, "f5": false },
      "distance_state": "MID"
    },
    {
      "sequence_id": 2,
      "mode": 1,
      "flex": { "f1": true, "f2": false, "f3": true, "f4": false, "f5": false },
      "distance_state": "HIGH"
    }
  ]
}
```

- `sequence_id`: 1-based integer incrementing sequentially (`1, 2, 3...`) representing word order.
- `flex`: Object with boolean properties `f1` to `f5` corresponding to `thumb` to `little`.
- `distance_state`: `"LOW"`, `"MID"`, or `"HIGH"`.

## 4. State Machine & Windowing Lifecycle

```text
              any finger bent
       +------------------------------+
       |                              v
    +------+                      +------------+
    | IDLE |                      | COLLECTING |
    +------+                      +------------+
       ^                              |
       |                              |
       +------ strict REST -----------+
              10/10 all-open
```

- **IDLE:** All-open packets are ignored (`{ type: "WAITING" }`). The first packet with any bent finger initiates collection as packet 1.
- **COLLECTING:** Consecutive, non-overlapping windows of 10 packets are assembled.
  - **Valid window:** Gesture object accumulated; continues collecting.
  - **Rejected window:** Rejection event returned; previously accepted gestures preserved.
  - **Mode switch:** Interrupted window rejected (`MODE_CHANGED`); the new-mode packet seeds the fresh window.
  - **Strict REST:** 10/10 all-fingers-open window. Flushes accumulated gestures as `BATCH_READY`, or emits `EMPTY_SIGNING_SEQUENCE` if no gestures accumulated. Returns to `IDLE`.

## 5. Normalization Rules

- **Finger Voting:** Per-finger majority requires `>= 6 / 10` votes. A `5–5` split rejects the window (`FINGER_VOTE_TIE`).
- **Distance Voting:** Only packets with `ultrasonic.stable === true` vote. Requires `>= 6 / 10` votes for a single zone (`LOW`, `MID`, or `HIGH`). If fewer than 6 stable votes exist or no zone reaches 6, the window is rejected (`DISTANCE_NO_MAJORITY`).

## 6. Public API Usage

```javascript
const { createModule2 } = require("./backend/module2");

const module2 = createModule2();

function onModule1Packet(packet) {
  const result = module2.processReading(packet);

  switch (result.type) {
    case "WAITING":
      // Glove is idle waiting for signing to start
      break;
    case "WINDOW_COLLECTING":
      // Progressively collecting 10-packet window (result.readings)
      break;
    case "GESTURE_ACCEPTED":
      // One 10-packet gesture validated and accumulated
      break;
    case "WINDOW_REJECTED":
      // Window rejected (result.reason, result.details)
      break;
    case "BATCH_READY":
      // Strict REST reached; forward completed batch to Module 3
      forwardToModule3(result.batch);
      break;
    case "EMPTY_SIGNING_SEQUENCE":
      // Rest window reached without valid gestures
      break;
  }
}

// Reset processor state (e.g., on device disconnect)
module2.reset();
```

## 7. Configuration Reference (`config.js`)

| Constant | Value | Purpose |
|---|---|---|
| `WINDOW_SIZE` | `10` | Packets per fixed window |
| `REQUIRED_MAJORITY` | `6` | 6/10 majority vote threshold |
| `FINGER_ORDER` | `["thumb", "index", "middle", "ring", "little"]` | Bit sequence |
| `ZONE_TO_DISTANCE_STATE` | `{ 1: "LOW", 2: "MID", 3: "HIGH" }` | Zone mapping |
| `VALID_MODES` | `[0, 1]` | Supported mode integers |
| `VALID_ZONES` | `[1, 2, 3]` | Supported ultrasonic zones |

## 8. Test Execution

Unit tests use Node.js built-in test runner (`node:test` and `node:assert/strict`):

```bash
npm test
```
