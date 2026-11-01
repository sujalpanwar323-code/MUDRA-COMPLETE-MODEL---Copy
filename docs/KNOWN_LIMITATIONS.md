# MUDRA — KNOWN LIMITATIONS & OPERATIONAL NOTES

**Document:** `docs/KNOWN_LIMITATIONS.md`  
**Date:** 2026-11-01  
**Status:** Documented  

---

## 1. Hardware Verification vs Simulation
- **Status:** Automated UDP simulation, mock packet feeds, and socket transmission tests have verified 100% of the software pipeline from UDP datagram ingestion through to frontend speech.
- **Physical ESP32 Note:** Physical hardware verification requires the physical ESP32 glove node powered on and connected to the same Wi-Fi LAN as the host machine, sending UDP packets to port 5005.

## 2. LLM Provider Dependency & Local Fallback
- **Local Ollama:** Default LLM is Ollama with model `qwen2.5:1.5b`. If `ollama serve` is not running or the model is not pulled, Module 4 automatically falls back to its built-in deterministic dictionary (e.g. `NEED WATER` → `I need water.`) or raw cleaned text within ~6 ms.
- **Cloud LLM (Anthropic):** Can be enabled by setting `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=your_key`.

## 3. Web Speech API Browser Compatibility
- Browser speech synthesis relies on the Web Speech API (`window.speechSynthesis`). This API is supported in modern desktop and mobile browsers (Chrome, Edge, Safari, Firefox). When testing headlessly or in environments without audio output devices, speech calls complete via fallback callbacks without errors.

## 4. Custom Gesture Calibration
- Custom gestures support up to 5 user slots stored atomically in `data/selection.json` and in frontend browser `localStorage`. Finger contact switches are digital binary switches; custom gesture assignment maps names and custom phrases to pre-calibrated uncalibrated pattern slots. Collisions with standard library patterns are prevented by the validator.
