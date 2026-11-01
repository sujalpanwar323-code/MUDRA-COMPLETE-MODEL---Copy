# MUDRA — DEPENDENCY INVENTORY

**Document:** `docs/DEPENDENCY_INVENTORY.md`  
**Date:** 2026-11-01  
**Status:** Complete  

---

## 1. Runtime Environment
- **Operating System:** Windows 11
- **Node.js:** v24.14.0
- **Package Manager:** npm (invoked via `npm.cmd` due to Windows PowerShell execution policy)
- **Target Hardware:** ESP32-WROOM-32 (Module 1 Glove Node), HC-SR04 ultrasonic sensor, 5x digital finger contact switches

---

## 2. Package Manifests & Dependencies

### 2.1 Recognition Pipeline (`services/recognition-pipeline` / Source A & B)
- **Manifest:** `package.json`
- **Module System:** CommonJS (`"type": "commonjs"`)
- **Direct Runtime Dependencies:**
  - `ws`: `^8.18.0` / `^8.22.0` (WebSocket server for frontend connection)
- **Built-in Node Modules Used:**
  - `dgram` (UDP datagram socket for Module 1 ESP32 communication)
  - `fs`, `path` (library loading and persistent custom gesture storage)
  - `crypto` (atomic write hashing / sequence verification)
  - `node:test`, `node:assert` (built-in Node.js test runner)

### 2.2 Sentence Generation Service (`services/sentence-service` / Source C)
- **Manifest:** `package.json`
- **Module System:** ES Modules (`"type": "module"`)
- **Direct Runtime Dependencies:**
  - `express`: `^4.19.2` (HTTP REST API on port 3000)
  - `@anthropic-ai/sdk`: `^0.40.0` (optional cloud LLM provider)
- **Local Services:**
  - Ollama (`http://localhost:11434` with model `qwen2.5:1.5b`) — optional; deterministic fallback dictionary operates if Ollama is offline.

### 2.3 React Frontend (`frontend` / Source C)
- **Manifest:** `package.json`
- **Module System:** ES Modules (`"type": "module"`)
- **Build Tool:** Vite `^5.4.10` / `@vitejs/plugin-react` `^4.3.3`
- **Direct Runtime Dependencies:**
  - `react`: `^18.3.1`
  - `react-dom`: `^18.3.1`
  - `framer-motion`: `^11.11.0` (animations)
  - `recharts`: `^2.13.0` (live sensor flex telemetry chart)
- **Browser APIs:**
  - `WebSocket` (live event stream from Module 3 on port 8080)
  - `window.speechSynthesis` / `SpeechSynthesisUtterance` (Web Speech API for local text-to-speech)
  - `localStorage` (persistence for custom user gestures)

---

## 3. Redundant / Generated Directories Identified for Exclusion
- `module_4/mudra ollama - Copy/sign-speech-node/node_modules/` (dependency directory)
- `module_4/mudra react - Copy/mudra-react/node_modules/` (dependency directory)
- `module_4/mudra react - Copy/sign-speech node/` (duplicate copy of sign-speech-node)
- `module_4/mudra react - Copy/mudra-react/src/server.js` (duplicate copy of server-backup.js)
- `3 INTEGRATION V2/node_modules/` (dependency directory)
- `MODULE 2+3 V2 - Copy/node_modules/` (dependency directory)
