
const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
const CLIENT_TIMEOUT_MS = 2500;

export async function makeSentence(words) {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);

  try {
    const r = await fetch(`${API}/sentence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: words, lang: "en" }),
      signal: ctl.signal,
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const d = await r.json();
    return {
      sentence: d.sentence,
      source: d.source,
      ms: d.ms ?? Math.round(performance.now() - t0),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function speak(text, lang, onEnd) {
  if (!("speechSynthesis" in window) || !text) {
    onEnd && onEnd();
    return;
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "hi" ? "hi-IN" : "en-IN";
  u.onend = u.onerror = () => onEnd && onEnd();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
}

// Translate English sentences into Hindi and Hinglish.
export async function translateSentence(sentence) {
  if (!sentence?.trim()) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);

  try {
    const r = await fetch(`${API}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence }),
      signal: ctl.signal,
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const data = await r.json();

    if (
      typeof data.hindi !== "string" ||
      typeof data.hinglish !== "string"
    ) {
      return null;
    }

    return {
      hindi: data.hindi,
      hinglish: data.hinglish,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
