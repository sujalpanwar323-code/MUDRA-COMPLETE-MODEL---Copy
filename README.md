# MUDRA — Smart Gesture-to-Speech Assistive Communication System

MUDRA is an assistive hardware-software system that captures physical hand gestures and distance measurements from an ESP32 sensor glove, normalizes and windows the signal stream, recognizes gestures against an extensive gesture library, constructs grammatically fluent natural language sentences via local or cloud LLMs (with instant deterministic fallbacks), and delivers spoken voice output in English, Hindi, and Hinglish.

---

## 1. System Pipeline Architecture

```text
┌──────────────────────────────────────────────┐
│ MODULE 1: HARDWARE DATA ACQUISITION          │
│ ESP32 Sensor Glove Node                      │
│ 5 Digital Finger Contact Switches            │
│ HC-SR04 Ultrasonic Distance Sensor           │
│ Broadcasts UDP JSON datagrams @ 10 Hz (5005) │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ (UDP Port 5005)
┌──────────────────────────────────────────────┐
│ MODULE 2: SIGNAL WINDOWING & NORMALIZATION   │
│ Ingestion Bridge (services/recognition-pipe) │
│ 10-Packet Non-Overlapping Windows            │
│ Finger Majority Voting (>= 6/10)             │
│ Ultrasonic Distance Quantization & Voting    │
│ Strict REST Detection (10/10 all open)       │
│ Emits BATCH_READY when user pauses gesture   │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ (Boundary Adapter: 5-Bit Flex + Distance)
┌──────────────────────────────────────────────┐
│ MODULE 3: GESTURE RECOGNITION ENGINE         │
│ 50-Gesture Standard Demonstration Library    │
│ 5-Slot Atomic Custom Gesture Management      │
│ 15-Phrase 5-Bit Emergency Fallback Library   │
│ Zero Fabrication (honest NO_MATCH handling)  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ (WebSocket Broadcast @ ws://localhost:8080)
┌──────────────────────────────────────────────┐
│ REACT FRONTEND INTERFACE                     │
│ Live Sensor Glove Telemetry & Flex Chart     │
│ Real-Time Gesture Display & Confidence       │
│ Phrase Queue Management                      │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ (HTTP POST http://localhost:3000/sentence)
┌──────────────────────────────────────────────┐
│ MODULE 4: SENTENCE GENERATION SERVICE        │
│ 1200ms Timeout Budget                        │
│ In-Memory Fast Cache (<5ms response)         │
│ Local Ollama (qwen2.5:1.5b) or Anthropic API │
│ Instant Fallback Dictionary (e.g. NEED WATER)│
│ Multilingual Translation (/translate)        │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ (HTTP JSON Response)
┌──────────────────────────────────────────────┐
│ REACT FRONTEND DISPLAY & TEXT-TO-SPEECH      │
│ Formatted English Sentence Display           │
│ Multilingual Hindi / Hinglish Cards          │
│ Web Speech API (Local Browser Speech Engine) │
│ Dedicated Direct Emergency Alert & Speech    │
└──────────────────────────────────────────────┘
```

---

## 2. Repository Structure

```text
MUDRA COMPLETE MODEL/
├── package.json                 # Root orchestrator scripts
├── README.md                    # System documentation
│
├── 3 INTEGRATION V2/            # Canonical Module 1 bridge + Module 2 + Module 3
│   ├── udp_bridge.js            # UDP 5005 ingestion, telemetry, WebSocket 8080
│   ├── backend/module2/         # Module 2 windowing & normalization
│   ├── src/                     # Module 3 recognition and WebSocket transport
│   ├── module1/glove_node/      # ESP32 firmware
│   ├── data/                    # Standard, custom, & emergency gesture libraries
│   └── tests/                   # Recognition and adapter tests
│
├── services/sentence-service/   # Module 4 sentence generation backend
│   ├── server.js                # HTTP API on port 3000 with LLM and fallbacks
│   ├── test.js
│   └── test_cases.json
│
├── hardware/docs/              # Circuit schematics & GPIO pinouts
│
├── frontend/                    # MUDRA React 18 + Vite Application
│   ├── src/App.jsx              # Main UI, phrase queue, emergency screen
│   ├── src/useGlove.js          # WebSocket hook connecting to Module 3
│   ├── src/api.js               # Module 4 HTTP client & Web Speech TTS
│   ├── src/gestures.js          # Predefined gestures & custom slot definitions
│   └── src/styles.css           # Assistive accessible dark/light theme
│
├── scripts/
│   ├── orchestrate_pipeline.js  # Launches all 3 services in one terminal
│   └── simulate_e2e.js          # End-to-end verification script
│
└── docs/                        # Complete Engineering Documentation
    ├── REPOSITORY_AUDIT.md      # Stage 0 repository audit
    ├── DEPENDENCY_INVENTORY.md  # Runtime dependencies & exclusions
    ├── FILE_CONFLICT_MATRIX.md  # Conflict analysis and resolution
    ├── BASELINE_VERIFICATION.md # Baseline test records
    ├── MERGE_DECISIONS.md       # Merge decision records (MDR-001 - MDR-008)
    ├── API_CONTRACTS.md         # Wire protocols & JSON schemas
    ├── EMERGENCY_FLOW_AUDIT.md  # Emergency flow audit & crash fix
    ├── ARCHITECTURE_DECISIONS.md# Architecture decision records
    ├── TEST_RESULTS.md          # Complete test execution logs
    ├── KNOWN_LIMITATIONS.md     # Hardware & deployment notes
    └── FINAL_INTEGRATION_REPORT.md # Final engineering review
```

---

## 3. Quick Start Guide

### 3.1 Run Complete End-to-End Simulation
To verify the live pipeline (ESP-shaped UDP packets → Module 2 → Module 3 → WebSocket → Module 4, including hardware emergency mode):
```bash
node scripts/simulate_e2e.js
```

### 3.2 Run Automated Test Suites
```bash
npm test
```

### 3.3 Launch All Services Concurrently
To start the entire MUDRA system for live testing and demonstration:
```bash
npm run start:all
```
This launches:
1. **Recognition Pipeline:** UDP listener on `0.0.0.0:5005`, WebSocket server on `ws://0.0.0.0:8080`.
2. **Sentence Service (Module 4):** HTTP server on `http://localhost:3000`.
3. **React Frontend:** Vite dev server on `http://localhost:5173`.

### 3.4 Launch Individual Services Separately
If you prefer running services in dedicated terminals:
- **Terminal 1 (Recognition Pipeline):**
  ```bash
  npm run start:recognition
  ```
- **Terminal 2 (Module 4 Sentence Service):**
  ```bash
  npm run start:sentence
  ```
- **Terminal 3 (React Frontend):**
  ```bash
  npm run start:frontend
  ```

---

## 4. Hardware Connection (ESP32 Glove)

1. Open `3 INTEGRATION V2/module1/glove_node/glove_node.ino` in Arduino IDE.
2. Configure your 2.4 GHz Wi-Fi SSID, password, and the IPv4 address of your computer running `udp_bridge.js`.
3. Flash to the ESP32.
4. When powered on, the glove sends contact states and ultrasonic distance packets over UDP to port `5005`.
5. Observe the live flex chart and recognized gestures on the React frontend at `http://localhost:5173`.

---

## 5. Emergency Mode Operation

- **Activating:** Toggle the tactile glove button to Mode 1 or activate emergency mode in the frontend.
- **Direct Recognition:** Module 3 matches 5-bit flex patterns directly against `fallbackLibrary.json` (15 critical emergency phrases).
- **Zero Latency:** Bypasses Module 4 LLM processing entirely, broadcasting `EMERGENCY_RESULT` over WebSocket for instant display and local browser voice announcement.
