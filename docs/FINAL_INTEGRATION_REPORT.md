# MUDRA — Current Pipeline Integration Status

**Updated:** 2026-11-01  
**Status:** Code wiring repaired; runtime and hardware verification pending

## Pipeline

```text
ESP32 JSON over UDP 5005
  -> canonical bridge in `3 INTEGRATION V2/udp_bridge.js`
  -> Module 2 validation, 10-packet windows, and REST boundary
  -> Module 3 gesture recognition
  -> WebSocket telemetry and recognition events on port 8080
  -> frontend phrase queue and Module 4 HTTP request on port 3000
  -> sentence display and browser speech
```

The ESP emits `emergency_mode: true` when its button selects Mode 1. Module 3
uses the deterministic emergency library and emits an
`EMERGENCY_RESULT`; the frontend uses the same WebSocket stream to display it.

## Repairs in this update

- Root lifecycle scripts now launch the canonical `3 INTEGRATION V2` bridge.
- The bridge starts UDP and WebSocket listeners and reports readiness only after
  both listeners are available.
- Per-packet telemetry now includes finger values, distance, sequence, mode, and
  Module 2 state in the shape consumed by the frontend.
- Module 3 emits dedicated emergency events. The explicit hardware emergency
  flag selects emergency
  recognition, and frontend-visible sequence IDs remain unique across batches.
- The emergency library contains the intended phrases rather than demo text.
- The E2E simulator now sends ESP-shaped packets through the UDP socket, checks
  the WebSocket recognition event, calls Module 4 with those keywords, and
  checks the hardware emergency event.
- `udp_receiver.js` now delegates to the canonical bridge instead of maintaining
  a second, permissive packet normalizer.

## Verification status

- JavaScript syntax checks passed for the changed runtime files.
- JSON parsing checks passed for the root package and emergency library.
- The automated test suites and E2E simulator have **not** been run in this
  update. The previous `docs/TEST_RESULTS.md` is a historical baseline and does
  not verify these changes.
- Hardware operation still depends on configuring the ESP32 for the current
  Wi-Fi network and host IPv4 address, and validating gesture patterns with the
  actual sensors.

## Start the system

```bash
npm start
```

The manager starts the recognition bridge, Module 4, and the frontend on their
fixed ports. For the local simulated data path, run:

```bash
npm run simulate:e2e
```
