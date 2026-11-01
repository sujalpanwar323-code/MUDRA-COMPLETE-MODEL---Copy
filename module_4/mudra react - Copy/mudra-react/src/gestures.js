// Gesture lists for the frontend. Edit labels here only; the rest of the app reads from this file.
// Labels must match EXACTLY what the backend (Module 2/3) sends in `gesture` (same spelling, capitals).

// Gestures already in the library.
export const BASE_GESTURES = ["HELLO", "WATER", "HELP", "NEED", "THANK YOU", "PAIN"];

// Custom gestures are written by the user on the "Custom gestures" tab (max CUSTOM_LIMIT) and saved in the browser.
// Start empty. Put names here only if you want some pre-filled, e.g. ["WASHROOM"].
export const CUSTOM_GESTURES = [];
export const CUSTOM_LIMIT = 5;

// Emergency phrases: one press speaks the sentence straight away (no glove, no server, no LLM needed).
// PLACEHOLDER list: replace with the team lead's critical phrases once confirmed.
export const EMERGENCY_PHRASES = [
  { label: "HELP", phrase: "I need help, please come here." },
  { label: "PAIN", phrase: "I am in pain, please call a doctor." },
  { label: "WATER", phrase: "I need water, please." },
  { label: "WASHROOM", phrase: "I need to use the washroom." },
  { label: "MEDICINE", phrase: "I need my medicine." },
];
