# MUDRA — MODULE COMMUNICATION PROTOCOLS & API CONTRACTS

**Document:** `docs/API_CONTRACTS.md`  
**Date:** 2026-11-01  
**Status:** Complete  

---

## 1. Pipeline Communication Topology

The authoritative MUDRA system operates via the following verified topology:

```text
[ESP32 Glove / Hardware]
           │
           ▼ (UDP Port 5005, JSON Datagrams @ 10 Hz)
[Module 1 Ingestion & Normalization Bridge]
           │
           ▼ (In-process synchronous method call)
[Module 2: 10-Packet Windowing & Strict REST Detection]
           │
           ▼ (BATCH_READY event with accepted gestures)
[Boundary Adapter: 5-Bit Flex & Quantized Distance String]
           │
           ▼ (In-process asynchronous recognition call)
[Module 3: Pattern Keys & Gesture Library Lookup]
           │
           ▼ (WebSocket Port 8080 JSON Broadcast)
[React Frontend (useGlove Hook & App.jsx)]
           │
           ▼ (HTTP POST /sentence @ Port 3000)
[Module 4: Sentence Construction & Deterministic Fallback]
           │
           ▼ (HTTP JSON Response)
[React Frontend: Sentence Display & Web Speech TTS]
```

---

## 2. Module Boundaries & Contract Specifications

### 2.1 Module 1 → Module 2 (UDP Ingestion Boundary)
- **Transport:** UDP IPv4 on port 5005
- **Producer:** ESP32 Firmware (`module1/glove_node/glove_node.ino`)
- **Consumer:** `udp_bridge.js` (`adaptModule1Packet`)
- **Packet Format (JSON):**
  ```json
  {
    "device": "MUDRA_01",
    "seq": 104,
    "mode": 0,
    "emergency_mode": false,
    "timestamp_ms": 20800,
    "fingers": {
      "thumb": true,
      "index": false,
      "middle": false,
      "ring": false,
      "little": false
    },
    "ultrasonic": {
      "valid": true,
      "distance_cm": 12.8
    },
    "gesture_code": 16
  }
  ```
- **Validation Rules:**
  - `mode` must be integer `0` or `1`.
  - `fingers` must contain 5 strict booleans (`thumb`, `index`, `middle`, `ring`, `little`).
  - `ultrasonic.distance_cm` is quantized into `LOW` (<=15.0cm), `MID` (15.1-35.0cm), or `HIGH` (>35.0cm). If `valid === false` or out-of-bounds, `distance_state` is `null` without fabricating readings.

### 2.2 Module 2 → Module 3 (Windowing to Recognition Boundary)
- **Producer:** `backend/module2/index.js` (`createModule2().processReading()`)
- **Trigger:** Strict REST window (10/10 all fingers open) after collecting gestures.
- **Consumer:** `udp_bridge.js` (`adaptBatchForModule3`) → `src/index.js` (`processModule2Message`)
- **Adapted Module 3 Batch Format (Array):**
  ```json
  [
    {
      "sequence_id": 1,
      "mode": 0,
      "flex": "10000",
      "distance_state": "LOW"
    }
  ]
  ```
- **Pattern Key Construction:**
  - Standard Gesture Key: `${mode}|${flex}|${distance_state}` (e.g. `0|10000|LOW`)
  - Fallback/Emergency Key: `${flex}` (5-bit string e.g. `00001`)

### 2.3 Module 3 → Frontend (WebSocket Broadcast Boundary)
- **Transport:** WebSocket on `ws://localhost:8080` (or configured host/port)
- **Producer:** `src/module3/webSocketServer.js` via `outputAdapter.js`
- **Consumer:** Frontend `useGlove.js`
- **Event Types:**
  1. **Handshake:**
     ```json
     {
       "type": "CONNECTION_ESTABLISHED",
       "version": "1.0.0",
       "endpoint": "ws://127.0.0.1:8080"
     }
     ```
  2. **Recognized Keywords (Normal Mode):**
     ```json
     {
       "type": "recognized_keywords",
       "keywords": ["STOP"]
     }
     ```
  3. **Live telemetry (each accepted ESP packet):**
     ```json
     {
       "type": "telemetry",
       "seq": 104,
       "mode": 0,
       "flex": [0, 100, 0, 0, 0],
       "rawFingers": { "thumb": false, "index": true, "middle": false, "ring": false, "little": false },
       "distance_state": "LOW",
       "m2State": "COLLECTING",
       "m2LastEvent": "WINDOW_COLLECTING"
     }
     ```
  4. **Emergency Result (hardware emergency_mode or frontend emergency mode):**
     ```json
     {
       "type": "EMERGENCY_RESULT",
       "mode": "EMERGENCY",
       "trigger": "hardware",
       "status": "MATCH",
       "sequence_id": 1,
       "sentence": "I need help."
     }
     ```
  5. **Emergency Status Toggle:**
     ```json
     {
       "type": "EMERGENCY_MODE_STATUS",
       "active": true
     }
     ```

### 2.4 Frontend → Module 4 (Sentence Request Boundary)
- **Transport:** HTTP POST to `http://localhost:3000/sentence`
- **Request Body:**
  ```json
  {
    "keywords": ["I", "NEED", "WATER"],
    "lang": "en"
  }
  ```
- **Response Body:**
  ```json
  {
    "sentence": "I need water.",
    "source": "cache",
    "ms": 2
  }
  ```
- **Response Sources:**
  - `"cache"`: Instant response (<5ms) for previously generated phrases.
  - `"llm"`: Generated sentence from Ollama or Claude within 1200ms budget.
  - `"fallback"`: Instant deterministic dictionary response when LLM is unavailable or times out.
  - `"raw"`: Cleaned, capitalized raw keywords.

### 2.5 Multilingual Translation Boundary
- **Transport:** HTTP POST to `http://localhost:3000/translate`
- **Request Body:**
  ```json
  {
    "sentence": "I need water."
  }
  ```
- **Response Body:**
  ```json
  {
    "hindi": "मुझे पानी चाहिए।",
    "hinglish": "Mujhe paani chahiye."
  }
  ```
