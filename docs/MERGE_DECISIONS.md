# MUDRA — MERGE DECISION RECORDS

**Document:** `docs/MERGE_DECISIONS.md`  
**Date:** 2026-11-01  
**Status:** Approved & Documented  

---

### DECISION ID: MDR-001
- **COMPONENT:** Ingestion Bridge & Hardware Interface (`udp_bridge.js`)
- **SOURCE FILES:** `3 INTEGRATION V2/udp_bridge.js`
- **AUTHORITATIVE VERSION:** Source A with configurable WebSocket enablement
- **DECISION TYPE:** PORT / UPDATE
- **OBSERVED DIFFERENCES:** Source A instantiated `createModule3({ enableWebSocket: false })`, which prevented recognized keywords from being broadcast over WebSocket to the frontend.
- **RATIONALE:** The bridge must broadcast recognized keywords to the frontend when running the live system, but should support headless operation for CLI test suites.
- **FEATURES PRESERVED:** UDP 5005 listener, ultrasonic distance quantization, Module 1 packet adaptation, Module 2 windowing, and Module 3 recognition execution.
- **FEATURES PORTED:** Configurable `WS_ENABLE` (defaults to true in live mode) and `WS_PORT` (default 8080).
- **TESTS EXECUTED:** `udpBridgeIntegration.test.js`, live simulation test.
- **RESULT:** PASS.

---

### DECISION ID: MDR-002
- **COMPONENT:** Output Adapter (`src/outputAdapter.js`)
- **SOURCE FILES:** `3 INTEGRATION V2/src/outputAdapter.js`, `MODULE 2+3 V2 - Copy/src/outputAdapter.js`
- **AUTHORITATIVE VERSION:** Source B merged into authoritative codebase
- **DECISION TYPE:** PORT / MERGE
- **OBSERVED DIFFERENCES:** Source B added `buildEmergencyPayload`, `serializeEmergencyPayload`, and `serializeOutboundPayload` to format `EMERGENCY_RESULT` payloads for the frontend.
- **RATIONALE:** Emergency mode must communicate structured `EMERGENCY_RESULT` frames containing sequence ID and deterministic sentence.
- **FEATURES PRESERVED:** All `buildKeywordPayload`, `serializeKeywordPayload`, and `deliverPayload` methods from Source A.
- **FEATURES PORTED:** Emergency payload builders and serializers from Source B.
- **TESTS EXECUTED:** `tests/outputAdapter.test.js` (including all new emergency serializer test cases).
- **RESULT:** PASS.

---

### DECISION ID: MDR-003
- **COMPONENT:** WebSocket Adapter (`src/webSocketAdapter.js`)
- **SOURCE FILES:** `3 INTEGRATION V2/src/webSocketAdapter.js`, `MODULE 2+3 V2 - Copy/src/webSocketAdapter.js`
- **AUTHORITATIVE VERSION:** Source B
- **DECISION TYPE:** MERGE
- **OBSERVED DIFFERENCES:** Source B uses `serializeOutboundPayload` instead of `serializeKeywordPayload` so both normal keyword batches and emergency payloads can be sent over WebSocket.
- **RATIONALE:** Required for frontend compatibility in both normal and emergency modes.
- **FEATURES PRESERVED:** Full WebSocket server lifecycle, connection handshakes, Buffer frame support, client cleanup.
- **FEATURES PORTED:** Outbound serializer selector.
- **TESTS EXECUTED:** `tests/webSocketAdapter.test.js`.
- **RESULT:** PASS.

---

### DECISION ID: MDR-004
- **COMPONENT:** Main Pipeline Orchestrator (`src/index.js`)
- **SOURCE FILES:** `3 INTEGRATION V2/src/index.js`, `MODULE 2+3 V2 - Copy/src/index.js`
- **AUTHORITATIVE VERSION:** Merged (A + B)
- **DECISION TYPE:** MERGE
- **OBSERVED DIFFERENCES:** Source B added `sendEmergencyResults(results)` for emergency recognition delivery, but changed default host to `"0.0.0.0"`, causing test failure.
- **RATIONALE:** Preserve emergency result broadcasting from B while maintaining default host `"127.0.0.1"` (configurable via environment/options) to ensure test compliance.
- **FEATURES PRESERVED:** Working Module 1/2/3 pipeline, default local binding.
- **FEATURES PORTED:** `sendEmergencyResults` and snapshot mode handling.
- **TESTS EXECUTED:** `tests/integration.test.js`.
- **RESULT:** PASS.

---

### DECISION ID: MDR-005
- **COMPONENT:** Fallback Library (`data/fallbackLibrary.json`)
- **SOURCE FILES:** `3 INTEGRATION V2/data/fallbackLibrary.json`, `MODULE 2+3 V2 - Copy/data/fallbackLibrary.json`
- **AUTHORITATIVE VERSION:** Source B
- **DECISION TYPE:** REPLACE
- **OBSERVED DIFFERENCES:** Source A contained dummy placeholder strings (`"Demo fallback sentence 01"`). Source B contained 15 genuine emergency sentences (`"I need help."`, `"Please call an ambulance."`, `"I am in severe pain."`, etc.).
- **RATIONALE:** A real-world assistive and emergency system must present actionable, medically relevant fallback sentences.
- **FEATURES PRESERVED:** Exactly 15 unique 5-bit flex patterns (`00001` through `01111`).
- **TESTS EXECUTED:** `tests/fallback.test.js`, `tests/libraries.test.js`.
- **RESULT:** PASS.

---

### DECISION ID: MDR-006
- **COMPONENT:** Sentence Generation Backend Service
- **SOURCE FILES:** `module_4/mudra ollama - Copy/sign-speech-node/server.js`
- **AUTHORITATIVE VERSION:** Source C `sign-speech-node/server.js`
- **DECISION TYPE:** KEEP / ENHANCE
- **OBSERVED DIFFERENCES:** Multiple duplicate server files existed (`sign-speech node/server.js`, `mudra-react/src/server.js`). The one in `mudra ollama - Copy/sign-speech-node/server.js` is the most complete, supporting Ollama, Anthropic, caching, emergency fallback dictionary, and Hindi/Hinglish translation.
- **RATIONALE:** Single authoritative sentence generation backend avoiding port conflicts.
- **FEATURES PRESERVED:** 1200ms budget, timeout controllers, fallback dictionary, cache, CORS headers.
- **TESTS EXECUTED:** `POST /sentence` integration tests.
- **RESULT:** PASS.

---

### DECISION ID: MDR-007
- **COMPONENT:** Frontend WebSocket Hook (`frontend/src/useGlove.js`)
- **SOURCE FILES:** `module_4/mudra react - Copy/mudra-react/src/useGlove.js`
- **AUTHORITATIVE VERSION:** Updated Source C
- **DECISION TYPE:** PORT / FIX
- **OBSERVED DIFFERENCES:** Did not handle message type `recognized_keywords`, causing all normal recognition from Module 3 to be dropped. Hardcoded LAN IP `172.20.52.88:8080`.
- **RATIONALE:** Enable seamless end-to-end communication from Module 3 to the React UI and sentence generator.
- **FEATURES PRESERVED:** Connection lifecycle, exponential backoff, mode switching, chart history.
- **FEATURES PORTED:** Added `case "recognized_keywords"`, `case "CONNECTION_ESTABLISHED"`, and default `ws://localhost:8080`.
- **TESTS EXECUTED:** End-to-end WebSocket recognition test.
- **RESULT:** PASS.

---

### DECISION ID: MDR-008
- **COMPONENT:** Frontend UI Application (`frontend/src/App.jsx`)
- **SOURCE FILES:** `module_4/mudra react - Copy/mudra-react/src/App.jsx`
- **AUTHORITATIVE VERSION:** Updated Source C
- **DECISION TYPE:** PORT / FIX
- **OBSERVED DIFFERENCES:** Blank screen crash when emergency phrase was spoken (object was passed into `log` and rendered as a React child). Redundant duplicate emergency buttons.
- **RATIONALE:** Emergency UI must never crash.
- **FEATURES PRESERVED:** Complete UI styling, tabs, TTS speech playback, translation display, custom gestures.
- **FEATURES PORTED:** Sanitized emergency phrase extraction, eliminated duplicate buttons.
- **TESTS EXECUTED:** UI build test (`npm.cmd run build`), emergency mode simulation.
- **RESULT:** PASS.
