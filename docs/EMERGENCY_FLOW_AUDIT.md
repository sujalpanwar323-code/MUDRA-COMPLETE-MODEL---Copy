# MUDRA — EMERGENCY FLOW AUDIT

**Document:** `docs/EMERGENCY_FLOW_AUDIT.md`  
**Date:** 2026-11-01  
**Status:** Audited & Verified  

---

## 1. Objective
Verify the end-to-end emergency communication path to guarantee that emergency gestures are recognized deterministically, bypass LLM latency, function when Module 4 is offline, and never cause frontend instability.

---

## 2. Emergency Flow Stages

```text
User Emergency Trigger (Tactile Button or Mode Switch or Emergency Gesture)
                          │
                          ▼
             Module 3 Emergency Mode Active
                          │
                          ▼
            5-Bit Flex Pattern Classification
              (Using fallbackLibrary.json)
                          │
                          ▼
             Deterministic Emergency Phrase
             (e.g., "I need help immediately.")
                          │
                          ▼
           WebSocket Broadcast (EMERGENCY_RESULT)
                          │
                          ▼
                 React Frontend UI
              (Displays 🚨 Alert Banner)
                          │
                          ▼
            Local Browser Web Speech TTS
               (Immediate Audio Speech)
```

---

## 3. Audited Components & Findings

### 3.1 Fallback Emergency Library (`data/fallbackLibrary.json`)
- Source B contains exactly 15 unique 5-bit binary patterns (`00001` through `01111`) mapped to vital emergency phrases:
  1. `00001` → `"I need help."`
  2. `00010` → `"Please call an ambulance."`
  3. `00011` → `"I am having difficulty breathing."`
  4. `00100` → `"I am in severe pain."`
  5. `00101` → `"Please call my family."`
  6. `00110` → `"I need water."`
  7. `00111` → `"I feel dizzy."`
  8. `01000` → `"I am feeling very sick."`
  9. `01001` → `"Please take me to the hospital."`
  10. `01010` → `"I cannot move."`
  11. `01011` → `"I am feeling unsafe."`
  12. `01100` → `"Please stay with me."`
  13. `01101` → `"I need my medication."`
  14. `01110` → `"I have fallen and need assistance."`
  15. `01111` → `"Please contact emergency services."`
- **Audit Decision:** This file is authoritative and replaces Source A's placeholder sentences.

### 3.2 Output Serialization (`outputAdapter.js`)
- `buildEmergencyPayload(result)` creates:
  ```json
  {
    "type": "EMERGENCY_RESULT",
    "mode": "EMERGENCY",
    "status": "MATCH",
    "sequence_id": 1,
    "sentence": "I need help."
  }
  ```
- If no match occurs, it emits `status: "NO_MATCH"` without fabricating a guess.
- `serializeEmergencyPayload` validates the structure and stringifies the JSON.

### 3.3 Frontend Crash Investigation & Fix (R-009)
- **Defect:** In `App.jsx`, line 28 defined:
  `const emergencyResult = emergencySentence ? { status: "MATCH", sentence: emergencySentence } : null;`
  Where `emergencySentence` is `{ id: 1, sequenceId: 104, sentence: "I need help." }`.
  When Speak was clicked, `onEmergency(emergencyResult.sentence)` received the raw object `{ id, sequenceId, sentence }`.
  `onEmergency` pushed this object into `log`: `setLog(l => [phrase, ...l])`.
  In the JSX render tree, `log.map(l => <span>{l}</span>)` attempted to render the object directly as a React child, which immediately caused an unhandled React error:
  `Objects are not valid as a React child (found: object with keys {id, sequenceId, sentence})`.
  This turned the entire screen white.
- **Fix:**
  1. Corrected `emergencyResult.sentence` to extract `emergencySentence.sentence`.
  2. In `onEmergency(phrase)`, strictly sanitize the input:
     ```javascript
     const text = typeof phrase === "object" ? phrase?.sentence || "" : String(phrase || "");
     ```
  3. Removed duplicate emergency button JSX block.
- **Result:** Tested and verified. The emergency screen remains fully interactive, speech triggers reliably, and no white screen occurs.

### 3.4 Module 4 Offline Resilience
- When emergency mode is active, the frontend receives `EMERGENCY_RESULT` directly from Module 3 and immediately triggers Web Speech API `speak(sentence)`. It does NOT make any HTTP request to Module 4.
- If Module 4 is offline, stopped, or experiencing latency, emergency speech and UI alerts continue functioning with 0ms dependency on external services.
