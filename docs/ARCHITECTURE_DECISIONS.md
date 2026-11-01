# MUDRA — ARCHITECTURE DECISION RECORDS

**Document:** `docs/ARCHITECTURE_DECISIONS.md`  
**Date:** 2026-11-01  
**Status:** Approved  

---

### ADR-001: Preservation of the Module 1 → Module 2 → Module 3 Baseline
- **Context:** Source A (`3 INTEGRATION V2`) has a verified, working hardware ingestion and gesture recognition pipeline with 138 passing tests.
- **Alternatives Considered:**
  1. Rewrite Module 2 and Module 3 into a single monolithic server.
  2. Adopt Source B as the primary baseline.
  3. Preserve Source A as baseline and merge compatible adapters and test cases from Source B.
- **Selected Approach:** Option 3.
- **Rationale:** Preserves verified signal processing algorithms (10-packet windowing, majority voting, strict REST detection) and pattern matching while incorporating emergency capabilities.

---

### ADR-002: Network Topology — Frontend-Brokered vs Direct Backend-to-Backend
- **Context:** Need to establish the authoritative communication path between Module 3, Module 4, and Frontend.
- **Alternatives Considered:**
  1. Direct backend-to-backend: Module 3 calls Module 4 via HTTP, then Module 4 or Module 3 calls Frontend.
  2. Frontend-brokered: Module 3 broadcasts recognized keywords to Frontend over WebSocket, Frontend initiates `POST /sentence` to Module 4.
- **Selected Approach:** Frontend-brokered topology (Option 2).
- **Rationale:** Aligns with existing frontend state management, avoids dual network hops or duplicate sentence generation requests, and gives the frontend complete control over caching, user voice selection, speech synthesis, and cancellation.

---

### ADR-003: Sentence Generation Service Consolidation
- **Context:** Multiple copies of `server.js` existed across `mudra ollama - Copy` and `mudra react - Copy`.
- **Alternatives Considered:**
  1. Maintain multiple servers.
  2. Select `mudra ollama - Copy/sign-speech-node/server.js` as the single authoritative sentence service.
- **Selected Approach:** Option 2.
- **Rationale:** Contains the complete implementation: cache, 1200ms budget, deterministic fallback dictionary, Ollama support, Anthropic support, and `/translate` endpoint.

---

### ADR-004: Clean Repository Layout
- **Context:** Restructuring repository to provide clear boundaries without deleting user source files.
- **Selected Layout:**
  - `3 INTEGRATION V2/`: Authoritative hardware bridge, Module 2, Module 3, WebSocket server.
  - `services/sentence-service/`: Authoritative Module 4 backend.
  - `frontend/`: Authoritative React frontend.
  - `hardware/`: ESP32 firmware and circuit schematics.
  - `scripts/`: Unified startup, simulation, and smoke test orchestrators.
  - `docs/`: All architecture, risk, test, and protocol records.
