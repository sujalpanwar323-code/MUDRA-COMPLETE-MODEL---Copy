# MUDRA — FILE CONFLICT MATRIX

**Document:** `docs/FILE_CONFLICT_MATRIX.md`  
**Date:** 2026-11-01  
**Status:** Complete  

---

## Conflict Inventory and Resolution Categories

| File / Component | Source A (`3 INTEGRATION V2`) | Source B (`MODULE 2+3 V2 - Copy`) | Source C (`module_4`) | Decision | Risk | Rationale |
|---|---|---|---|---|---|---|
| `module1/glove_node/*` | Present (authoritative ESP32 firmware) | Missing | N/A | **KEEP (A)** | Low | Source A contains the tested hardware firmware. |
| `udp_bridge.js` | Present (UDP 5005 ingestion bridge) | Missing | N/A | **PORT/UPDATE (A)** | High | Enable WebSocket server option so recognized keywords reach frontend. |
| `udp_receiver.js` | Present (packet debug tool) | Missing | N/A | **KEEP (A)** | Low | Retained for diagnostics. |
| `backend/module2/*` | Complete working implementation | Identical | N/A | **KEEP (A)** | Critical | Protected signal processing algorithm; verified 100% compliant. |
| `src/index.js` | Default host `127.0.0.1`, basic keyword delivery | Added `sendEmergencyResults`, but changed host to `0.0.0.0` breaking tests | N/A | **MERGE (A+B)** | High | Merge B's emergency delivery while preserving A's default host `127.0.0.1` (configurable). |
| `src/outputAdapter.js` | Standard keyword serializer only | Added `buildEmergencyPayload`, `serializeEmergencyPayload`, `serializeOutboundPayload` | N/A | **PORT (B)** | High | Port B's emergency payload builders into the authoritative adapter. |
| `src/webSocketAdapter.js` | Calls `serializeKeywordPayload` | Calls `serializeOutboundPayload` | N/A | **PORT (B)** | High | Port B's outbound serializer to support both keyword and emergency payloads. |
| `data/fallbackLibrary.json` | 15 placeholder sentences (`Demo fallback sentence 01...`) | 15 real emergency phrases (`I need help.`, `Please call an ambulance.`) | N/A | **REPLACE with (B)** | High | Real emergency phrases are required for safety and demonstration. |
| `data/gestureLibrary.json` | 50 standard gestures | Identical | N/A | **KEEP (A)** | Critical | Protected gesture library. |
| `data/customGestures.json` | 5 custom slots | Identical | N/A | **KEEP (A)** | Medium | Protected custom slots. |
| `tests/outputAdapter.test.js` | Standard tests | Added emergency serializer tests | N/A | **MERGE (A+B)** | Medium | Preserve complete test coverage for normal and emergency payloads. |
| `tests/integration.test.js` | Standard tests | Added emergency batch broadcast tests | N/A | **MERGE (A+B)** | Medium | Preserve complete test coverage. |
| `tests/udpBridgeIntegration.test.js` | Present (10/10 test) | Missing | N/A | **KEEP (A)** | High | Essential integration test for UDP packet ingestion and Module 2 windowing. |
| Module 4 server (`server.js`) | N/A | N/A | `mudra ollama - Copy/sign-speech-node/server.js` | **KEEP (C)** | High | Complete server supporting cache, Ollama/Anthropic, fallback dictionary, translation. |
| Duplicate Module 4 servers | N/A | N/A | `sign-speech node/server.js` & `mudra-react/src/server.js` | **ARCHIVE / EXCLUDE** | Medium | Redundant historical copies. |
| Frontend `useGlove.js` | N/A | N/A | Hardcoded LAN IP, missing `recognized_keywords` handler | **PORT/FIX (C)** | Critical | Add `recognized_keywords` and `CONNECTION_ESTABLISHED` handlers, fix default URL. |
| Frontend `App.jsx` | N/A | N/A | Emergency button crash (object in child), duplicate buttons | **PORT/FIX (C)** | Critical | Fix object string coercion and duplicate button block. |
| Frontend `.env` | N/A | N/A | Hardcoded `172.20.52.88:8080` | **UPDATE (C)** | Medium | Update to `http://localhost:3000` and `ws://localhost:8080`. |
