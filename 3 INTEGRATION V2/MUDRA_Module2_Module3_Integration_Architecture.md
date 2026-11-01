# MUDRA — Module 2 & Module 3 Integration Architecture & Guardrails

**Status:** Implementation Specification & Integration Guardrail  
**System:** MUDRA Sign Language Translation Pipeline  
**Runtime:** Node.js / JavaScript (CommonJS)  
**Modules Covered:** Module 2 (Stateful Windowing & Normalization) + Module 3 (Gesture Library Lookup & Keyword Sequencing)

---

## 1. Architectural Overview & System Boundaries

The integration layer sits between Module 2 and Module 3, orchestrated by a central process or test runner harness. The pipeline processes raw sensor streams from Module 1 (ESP32) and converts them into translated keyword sequences broadcast to the frontend (Module 4 / UI).

```text
+-----------------------------------------------------------------------------------+
|                                 BACKEND ORCHESTRATOR / RUNNER                     |
|                                                                                   |
|  +----------------+     packet stream     +--------------------+                  |
|  | Module 1 Input | --------------------> |      Module 2      |                  |
|  | Packet (JSON)  |                       | Stateful Processor |                  |
|  +----------------+                       +--------------------+                  |
|                                                     |                             |
|                                                     | emits BATCH_READY           |
|                                                     v                             |
|                                          +---------------------+                  |
|                                          | Boundary Adapter /  |                  |
|                                          | Orchestrator Logic  |                  |
|                                          +---------------------+                  |
|                                                     |                             |
|                                                     | direct gesture Array        |
|                                                     v                             |
|                                           +--------------------+                  |
|                                           |      Module 3      |                  |
|                                           | Gesture Library    |                  |
|                                           +--------------------+                  |
|                                                     |                             |
+-----------------------------------------------------|-----------------------------+
                                                      |
                                                      | WebSocket Broadcast
                                                      v
                                            +--------------------+
                                            |     Module 4 /     |
                                            | Frontend UI Client |
                                            +--------------------+
```

### Module Boundaries & Responsibilities

| Component | Responsibility | Boundary Rule |
|---|---|---|
| **Module 1 (Mock/Hardware)** | Emits single raw packet per sensor cycle. | Accepts zero logic from Module 2 or 3. |
| **Module 2** | Assembles 10-packet windows, applies 6/10 majority voting, enforces 10/10 strict REST, outputs `BATCH_READY`. | Pure in-memory state machine. No sockets, no direct Module 3 imports. |
| **Orchestrator Boundary Adapter** | Listens for Module 2 events, unwraps `result.batch.gestures`, checks data format, passes array to Module 3. | Prevents schema mismatches and handles session resets. |
| **Module 3** | Accepts direct array of normalized gestures, matches standard/custom/emergency patterns, sorts by `sequence_id`, broadcasts keywords via WebSocket. | Fully functional offline if WebSocket client is disconnected. |

---

## 2. Schema & Data Contract Specifications

### 2.1 Module 2 Event Output (`BATCH_READY`)
When a 10/10 all-open REST window is detected, Module 2 emits a `BATCH_READY` result event:

```json
{
  "type": "BATCH_READY",
  "batch": {
    "type": "gesture_batch",
    "gestures": [
      {
        "sequence_id": 1,
        "mode": 0,
        "flex": { "f1": true, "f2": false, "f3": false, "f4": false, "f5": false },
        "distance_state": "LOW"
      },
      {
        "sequence_id": 2,
        "mode": 1,
        "flex": { "f1": false, "f2": true, "f3": true, "f4": false, "f5": false },
        "distance_state": "MID"
      }
    ]
  }
}
```

### 2.2 Boundary Transformation Rule (Critical Interface)
Module 3's ingestion function `processModule2Message(gesturesArray)` **requires a direct JavaScript Array**.

**Orchestrator Transformation Code:**
```javascript
const result = module2.processReading(packet);

if (result.type === "BATCH_READY") {
  // Unwrap inner gestures array from Module 2 payload
  const gesturesArray = result.batch.gestures;
  
  // Forward directly to Module 3
  const recognitionResult = await module3.processModule2Message(gesturesArray);
}
```

### 2.3 Normalized Gesture Record Schema
Every element inside the array forwarded to Module 3 must conform to the following schema:

```json
{
  "sequence_id": 1,
  "mode": 0,
  "flex": {
    "f1": true,
    "f2": false,
    "f3": false,
    "f4": false,
    "f5": false
  },
  "distance_state": "LOW"
}
```

- `sequence_id` *(integer >= 1)*: Chronological word position in the signing sequence.
- `mode` *(integer 0 or 1)*: Signing mode toggle.
- `flex` *(object)*: Boolean finger extension states (`f1`=thumb, `f2`=index, `f3`=middle, `f4`=ring, `f5`=little).
- `distance_state` *(string)*: `"LOW"`, `"MID"`, or `"HIGH"`.

---

## 3. Standardized Project Directory & File Structure

To prevent recursive folder creation (e.g., `backend/module2/backend/module2`), all files must strictly follow this flat, canonical directory layout:

```text
mudra-system/
├── package.json
├── simulate_pipeline.js                <-- End-to-End Simulation Script (Module 1 -> 2 -> 3)
├── mock_packets.json                   <-- Recorded 110+ Packet Dataset
├── src/
│   ├── module2/
│   │   ├── config.js
│   │   ├── validate.js
│   │   ├── windowManager.js
│   │   ├── normalize.js
│   │   ├── stateMachine.js
│   │   └── index.js
│   └── module3/
│       ├── config.js
│       ├── module2InputAdapter.js
│       ├── gestureLibrary.js
│       ├── customSlots.js
│       ├── emergencyMode.js
│       ├── outputAdapter.js
│       ├── webSocketServer.js
│       └── index.js
└── tests/
    ├── module2.test.js                 <-- Module 2 Isolated Unit Tests (21 tests)
    ├── module3.test.js                 <-- Module 3 Unit & Custom Slot Tests
    └── integration.test.js             <-- Full Pipeline Integration Test
```

### Path Resolution Rules
1. All `require` statements must use relative paths starting from `src/` or `tests/`.
2. Do not nest package configurations. A single root `package.json` manages dependencies (`ws`, `node:test`).

---

## 4. End-to-End Execution Lifecycle & Pipeline Flow

```text
[Packet Ingestion]
        │
        ▼
Module 2: processReading(packet)
        │
        ├─► IDLE: Wait for first bent finger packet.
        ├─► COLLECTING: Fill 10-packet non-overlapping windows.
        │     ├─► Valid Gesture Window  ──► Add to pending gestures array.
        │     ├─► Rejected Window       ──► Retain prior accepted gestures.
        │     └─► Mode Switch           ──► Reject current window; start fresh with new-mode packet.
        │
        └─► 10/10 Strict REST Window Detected
              │
              ├─► If pending gestures > 0:
              │     └─► Emit BATCH_READY { batch: { gestures: [...] } }
              │
              └─► If pending gestures === 0:
                    └─► Emit EMPTY_SIGNING_SEQUENCE -> Return to IDLE.
        │
        ▼
[Orchestrator Adapter]
        │
        ├─► Extract gestures array: result.batch.gestures
        ├─► Validate non-empty array & sequence_id order
        └─► Call module3.processModule2Message(gesturesArray)
        │
        ▼
Module 3: Gesture Recognition & Broadcasting
        │
        ├─► Input Adapter: Validates flex keys & sequence_id
        ├─► Priority Matching:
        │     1. Emergency Library (if emergency mode active)
        │     2. Custom Slots
        │     3. Standard Library Patterns
        │
        ├─► Keyword Output Generation: Returns [{ sequence_id, keyword }]
        └─► WebSocket Server: Broadcasts {"type": "recognized_keywords", "keywords": [...]} to frontend
```

---

## 5. Developer & Coding Agent Guardrails

### Guardrail Directives
1. **Never Touch Core Logic During Integration Setup:**
   - Do not alter `normalize.js` or `stateMachine.js` in Module 2 or matching algorithms in Module 3.
   - Integration setup involves **ONLY** writing/updating `simulate_pipeline.js`, `integration.test.js`, or adapter bridges.

2. **Strict Flex Schema Handling:**
   - Ensure Module 3's `module2InputAdapter.js` handles object-based `flex` (`{ f1: true, ... }`).
   - If Module 3 expects a string (`"10000"`), convert it **strictly inside the adapter bridge**, not inside Module 2's core.

3. **No Network Blockers in Tests:**
   - Module 3 recognition must proceed even if no WebSocket client is connected (`ws` delivery returns `"disconnected"` status cleanly).

4. **Session Cleanup Discipline:**
   - When a simulation finishes or an error occurs, call `module2.reset()` to avoid stale gestures leaking into subsequent test runs.

---

## 6. End-to-End Simulation Script (`simulate_pipeline.js`)

Use this exact harness script to bomb mock packet streams through Module 2 into Module 3 and print the final output keywords:

```javascript
/**
 * MUDRA End-to-End Pipeline Simulator
 * Feeds Module 1 packet streams -> Module 2 -> Module 3 -> Keyword Output
 */

const fs = require("fs");
const path = require("path");
const { createModule2 } = require("./src/module2/index");
const { createModule3 } = require("./src/module3/index");

// Load mock dataset (e.g. 110 packets)
const mockDataPath = path.join(__dirname, "mock_packets.json");
const packets = JSON.parse(fs.readFileSync(mockDataPath, "utf8"));

const module2 = createModule2();
const module3 = createModule3({ enableWebSocket: false }); // Run headless for CLI simulation

console.log(`====================================================`);
console.log(`  MUDRA PIPELINE SIMULATOR`);
console.log(`  Loaded ${packets.length} packets from mock dataset.`);
console.log(`====================================================\n`);

async function runSimulation() {
  let batchCount = 0;

  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    const result = module2.processReading(packet);

    if (result.type === "GESTURE_ACCEPTED") {
      console.log(`[Packet #${i + 1}] Gesture Accepted -> Mode ${result.gesture.mode}, Distance: ${result.gesture.distance_state}`);
    } else if (result.type === "WINDOW_REJECTED") {
      console.log(`[Packet #${i + 1}] Window Rejected -> ${result.reason} (${result.details})`);
    } else if (result.type === "BATCH_READY") {
      batchCount++;
      console.log(`\n----------------------------------------------------`);
      console.log(`>>> BATCH READY #${batchCount} (Strict REST Detected) <<<`);
      console.log(`Extracted ${result.batch.gestures.length} gestures from Module 2.`);
      
      // Unwrap array for Module 3
      const gestures = result.batch.gestures;
      
      // Process through Module 3
      const recognition = await module3.processModule2Message(gestures);
      
      console.log(`Module 3 Recognition Status: ${recognition.status}`);
      console.log(`Recognized Keyword Sequence:`);
      recognition.keywords.forEach((item) => {
        console.log(`  Word #${item.sequence_id}: "${item.keyword}" (Confidence: ${item.confidence || "N/A"})`);
      });
      console.log(`----------------------------------------------------\n`);
    }
  }

  console.log(`\nSimulation Complete. Processed ${packets.length} packets, generated ${batchCount} gesture batch(es).`);
}

runSimulation().catch(console.error);
```