# MUDRA — REPOSITORY AUDIT

**Document:** `docs/REPOSITORY_AUDIT.md`  
**Date:** 2026-11-01  
**Status:** Stage 0 Complete  
**Role:** Senior Software Engineer & Integration Architect  

---

## 1. Executive Summary

A comprehensive repository audit was conducted across all three MUDRA source branches in the workspace:
1. `3 INTEGRATION V2` (Source A)
2. `MODULE 2+3 V2 - Copy` (Source B)
3. `module_4` (Source C)

The purpose of this audit is to identify active entry points, file dependencies, communication contracts, hardware schemas, conflict candidates, and integration gaps before executing code consolidation.

---

## 2. Inventory of Source Branches

### 2.1 SOURCE A — `3 INTEGRATION V2`
- **Role:** Baseline candidate for Module 1 → Module 2 → Module 3.
- **Components:**
  - `module1/glove_node/glove_node.ino`: ESP32 firmware capturing 5 finger contact switches (GPIOs 13, 14, 25, 26, 27) and HC-SR04 ultrasonic sensor (Trigger GPIO 5, Echo GPIO 18). Broadcasts JSON datagrams over UDP to port 5005 at 10 Hz.
  - `udp_bridge.js`: Ingestion bridge listening on UDP port 5005, quantizing distance, adapting packets into Module 2 input format, feeding frames into Module 2, and upon `BATCH_READY` adapting the batch into Module 3's format and executing recognition.
  - `udp_receiver.js`: Raw UDP packet debugging receiver.
  - `backend/module2/`: Pure function-based windowing and normalization module (`config.js`, `index.js`, `normalize.js`, `simulate.js`, `stateMachine.js`, `validate.js`, `windowManager.js`). Implements 10-packet non-overlapping windows, finger majority voting (>= 6/10), ultrasonic distance voting, and strict REST detection (10/10 all open).
  - `src/`: Module 3 recognition engine (`recognizer.js`, `patternKeys.js`, `reservedState.js`, `selectionStore.js`, `customGestures.js`, `fallbackRecognizer.js`, `libraries.js`, `module2InputAdapter.js`, `outputAdapter.js`, `validateInput.js`, `webSocketAdapter.js`, `module3/webSocketServer.js`).
  - `data/`: Standard gesture library (`gestureLibrary.json` with 50 gestures), custom gestures (`customGestures.json`), selection storage (`selection.json`), and fallback library (`fallbackLibrary.json`).
  - `tests/`: 13 test files covering all aspects of Module 2, Module 3, adapters, and UDP integration. 138/138 tests pass.
  - `mock_packets.json`: 110 recorded packets for deterministic offline testing.
  - `simulate_pipeline.js`: CLI simulator running Module 1 mock packets → Module 2 → Module 3.

### 2.2 SOURCE B — `MODULE 2+3 V2 - Copy`
- **Role:** Compatibility and downstream integration branch.
- **Key Differences vs Source A:**
  - Missing `module1/`, `udp_bridge.js`, `udp_receiver.js`, `tests/udpBridgeIntegration.test.js`.
  - `data/fallbackLibrary.json`: Contains 15 validated emergency sentences (e.g., `"I need help."`, `"Please call an ambulance."`) rather than placeholder strings.
  - `src/outputAdapter.js`: Implements `buildEmergencyPayload`, `serializeEmergencyPayload`, and `serializeOutboundPayload` to format `EMERGENCY_RESULT` messages.
  - `src/webSocketAdapter.js`: Uses `serializeOutboundPayload(payload)` to support broadcasting both `recognized_keywords` and `EMERGENCY_RESULT`.
  - `src/index.js`: Incorporates `sendEmergencyResults(results)` when `emergencyMode` is active. However, default host was set to `"0.0.0.0"`, causing a regression in test `integration.test.js:504`.
  - `tests/`: Additional unit and integration tests for emergency payloads and batch broadcasting.

### 2.3 SOURCE C — `module_4`
- **Role:** Sentence generation and frontend interface.
- **Components:**
  - `mudra ollama - Copy/sign-speech-node`: Authoritative backend sentence service (`server.js`). Listens on port 3000, accepts `POST /sentence`, checks cache, generates natural language sentences via local Ollama (`qwen2.5:1.5b`) or Anthropic Claude Haiku with 1200ms budget, provides instant deterministic fallback dictionary for emergency and common phrases, and provides `POST /translate` for Hindi and Hinglish.
  - `mudra react - Copy/mudra-react`: React 18 / Vite frontend (`App.jsx`, `api.js`, `useGlove.js`, `gestures.js`, `styles.css`). Connects to Module 3 via WebSocket, calls Module 4 `POST /sentence`, displays recognized words, generated sentences, and triggers browser Web Speech API.
  - Duplicate directories: `mudra react - Copy/sign-speech node` and `mudra react - Copy/mudra-react/src/server.js` are historical copies of `sign-speech-node`.

---

## 3. Discovered Integration Problems & Gaps

1. **UDP Bridge WebSocket Disconnect:**
   In `3 INTEGRATION V2/udp_bridge.js`, `module3` was instantiated with `{ enableWebSocket: false }`. Real/replayed hardware packets processed through Module 2 and Module 3 were never broadcast over WebSocket to the frontend.
2. **Missing WebSocket Event Handler in Frontend (`useGlove.js`):**
   `useGlove.js` connects to Module 3 WebSocket, but its message switch statement lacked a handler for `recognized_keywords`. Module 3 emitted `{ type: "recognized_keywords", keywords: [...] }`, but the frontend silently dropped the message, so `App.jsx` never received keywords.
3. **Emergency Button Blank Screen Crash (`App.jsx`):**
   In `App.jsx`, `emergencyResult` was defined as `{ status: "MATCH", sentence: emergencySentence }` where `emergencySentence` is an object `{ id, sequenceId, sentence }`. Clicking the Speak button passed this object to `onEmergency(phrase)`, which added the object into `log`. React crashed attempting to render the object directly inside `<span>{l}</span>`.
4. **Hardcoded LAN IP Address:**
   Frontend `.env` hardcoded `VITE_WS_URL=ws://172.20.52.88:8080`, and `useGlove.js` had `ws://192.168.1.10:8080`. When running locally, the frontend failed to connect to `localhost:8080`.
5. **Fallback Library Differences:**
   Source A had placeholder text (`"Demo fallback sentence 01"`), while Source B had the actual emergency phrases (`"I need help."`, `"Please call an ambulance."`).
6. **No Single Unified Orchestration Script:**
   The three pieces (Hardware UDP Bridge, Module 4 Sentence Service, React Frontend) each required manual terminal startup without coordination or end-to-end smoke verification.

---

## 4. Architectural Decision Summary

- Preserve Source A as the authoritative baseline for Module 1, Module 2, Module 3, and UDP integration.
- Port Source B's verified `outputAdapter.js` emergency payloads, `webSocketAdapter.js` outbound serialization, `index.js` emergency delivery, and real `fallbackLibrary.json` sentences into the pipeline.
- Fix default host to `127.0.0.1` (configurable via env/options) to ensure 100% test suite pass rate.
- Fix frontend `useGlove.js` to parse `recognized_keywords` and handle `CONNECTION_ESTABLISHED`.
- Fix frontend `App.jsx` emergency sentence rendering and `onEmergency` object bug to eliminate the blank-screen crash.
- Set default WebSocket URL to `ws://localhost:8080` while retaining environment override.
- Provide clean orchestration scripts to launch and test the complete pipeline.
