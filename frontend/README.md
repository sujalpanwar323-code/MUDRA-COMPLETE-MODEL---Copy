# MUDRA frontend (React + Vite)

    npm install
    cp .env.example .env     # fill VITE_API_URL and VITE_WS_URL, or leave empty for demo mode
    npm run dev

Flow (matches the PPT):
1. Glove packet {gesture, flex:[5], confidence} arrives over WebSocket.
2. UNKNOWN or confidence < 0.75 -> "UNKNOWN" shown, no word added.
3. Accepted gestures are added to the phrase queue (click a word to remove it).
4. Text is shown first. Speech happens ONLY when the user presses Speak (no auto-speak). Speak ends the phrase.
5. Optional "smart phrasing" toggle (off by default): rewrites the queue into a sentence via the Node backend
   (cache -> backend with 1.2 s budget -> local fallback). Still needs Speak to be heard.

Backend: POST {VITE_API_URL}/sentence with {keywords, lang} -> {sentence}
