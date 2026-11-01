import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import useGlove from "./useGlove.js";
import { makeSentence, translateSentence, speak, stopSpeaking } from "./api.js";
import { BASE_GESTURES, CUSTOM_GESTURES, CUSTOM_LIMIT } from "./gestures.js";

const FINGERS = ["T", "I", "M", "R", "P"];
const MIN_CONFIDENCE = 0.75; // below this the reading is treated as UNKNOWN
const REPEAT_MS = 1500;      // same gesture held longer than this is not added twice

let nextId = 1;

export default function App() {
  const {
    packet,
    history,
    live,
    simulate,
    kw,
    emergencyMode: mode,
    modeChanging: modePending,
    error: modeError,
    emergencySentence,
    setEmergencyMode: changeMode,
    telemetry,
    diagStatus,
  } = useGlove();
  const emergencyResult = emergencySentence
    ? { status: "MATCH", sentence: emergencySentence?.sentence || "" }
    : null;
  const [theme, setTheme] = useState("dark");
  const [tab, setTab] = useState("main"); // main | custom | emergency
  // Custom gestures written by the user: [{ id, label, phrase }]. Saved in the browser so they survive a refresh.
  const [customs, setCustoms] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mudra.customs"));
      if (Array.isArray(saved)) return saved;
    } catch { /* ignore */ }
    return CUSTOM_GESTURES.map((label, i) => ({ id: `c${Date.now()}-${i}`, label, phrase: "" }));
  });
  const [cName, setCName] = useState("");
  const [cPhrase, setCPhrase] = useState("");
  const [queue, setQueue] = useState([]);    // phrase queue: [{id, word}]
  const [label, setLabel] = useState("");    // last recognition: a word or "UNKNOWN"
  const [typed, setTyped] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [useLLM, setUseLLM] = useState(true);  // Off = show the raw words (safe mode if Ollama is down)
  const [sentence, setSentence] = useState(null); // { sentence, source, ms } from Module 4
  const [busy, setBusy] = useState(false);
  const [translations, setTranslations] = useState(null);
  const [translationState, setTranslationState] = useState("idle");
  const [log, setLog] = useState([]);        // phrases already spoken
  const last = useRef({ word: "", t: 0 });
  const speakToken = useRef(0); // so a cancelled phrase cannot mark a newer one as finished

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const addWord = (word) => {
    const w = word.trim().toUpperCase();
    if (!w) return;
    setQueue((q) => [...q, { id: nextId++, word: w }]);
  };

  // Every glove reading: UNKNOWN or low confidence -> show UNKNOWN, add nothing.
  useEffect(() => {
    const g = (packet.gesture || "").toUpperCase();
    if (!g || mode === "EMERGENCY") return;
    if (packet.source === "module3") {
      setLabel(g);
      return;
    }
    if (packet.source === "esp32") {
      // Live ESP32 sensor activity - telemetry only, not a recognized word
      return;
    }
    if (g === "UNKNOWN" || packet.confidence < MIN_CONFIDENCE) {
      setLabel("UNKNOWN");
      return;
    }
    setLabel(g);
    const now = Date.now();
    if (g === last.current.word && now - last.current.t < REPEAT_MS) return;
    last.current = { word: g, t: now };
    addWord(g);
  }, [packet]);

  // Module 3 "recognized_keywords" message: add each keyword to the phrase queue.
  useEffect(() => {
    if (!kw || mode === "EMERGENCY") return;
    kw.words.forEach((w) => addWord(w));
  }, [kw]);

  // Emergency recognition comes directly from Module 3; never send it to Module 4.
  // Clear normal queued words when emergency mode is acknowledged.
  useEffect(() => {
    if (mode === "EMERGENCY") { setQueue([]); setSentence(null); }
  }, [mode]);

  useEffect(() => {
    try { localStorage.setItem("mudra.customs", JSON.stringify(customs)); } catch { /* ignore */ }
  }, [customs]);

  const addCustom = () => {
    const label = cName.trim().toUpperCase();
    if (!label || customs.length >= CUSTOM_LIMIT || customs.some((c) => c.label === label)) return;
    setCustoms((c) => [...c, { id: `c${Date.now()}`, label, phrase: cPhrase.trim() }]);
    setCName("");
    setCPhrase("");
  };

  const words = queue.map((q) => q.word);
  const rawText = words.join(" ").toLowerCase();

  // Module 4: turn the queued words into a sentence for review. Never spoken until Speak is pressed.
  useEffect(() => {
    setSentence(null); // queue changed: old sentence is stale, show raw words meanwhile
    if (mode === "EMERGENCY" || !useLLM || !words.length) { setBusy(false); return; }
    let stale = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      const r = await makeSentence(words);
      if (!stale) { setSentence(r); setBusy(false); }
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
  }, [queue, useLLM, mode]);

  const shown = !words.length
    ? "Make a sign to begin"
    : useLLM && sentence ? sentence.sentence : rawText;

  // Translate only completed English output. Never delay English or emergency speech.
  useEffect(() => {
    if (!words.length || busy || (useLLM && !sentence) || mode === "EMERGENCY") {
      setTranslations(null);
      setTranslationState("idle");
      return;
    }
    let stale = false;
    setTranslations(null);
    setTranslationState("loading");
    translateSentence(shown).then((result) => {
      if (stale) return;
      setTranslations(result);
      setTranslationState(result ? "ready" : "error");
    });
    return () => { stale = true; };
  }, [shown, busy, mode, useLLM]);

  const speakText = (text, lang) => {
    if (!text || speaking || mode === "EMERGENCY") return;
    const tok = ++speakToken.current;
    setSpeaking(true);
    speak(text, lang === "hi" || lang === "hinglish" ? "hi" : "en", () => {
      if (speakToken.current === tok) setSpeaking(false);
    });
    setLog((l) => [text, ...l].slice(0, 5));
  };

  const onSpeak = () => {
    if (!words.length || speaking || mode === "EMERGENCY") return;
    const tok = ++speakToken.current;
    setSpeaking(true);
    speak(shown, "en", () => { if (speakToken.current === tok) setSpeaking(false); });
    setLog((l) => [shown, ...l].slice(0, 3));
    setQueue([]); // Speak ends the phrase; next gesture starts a new one
    setSentence(null);
  };

  const onStop = () => { speakToken.current++; stopSpeaking(); setSpeaking(false); };

  // Speak a fixed phrase directly via browser TTS, without Module 4.
  const onEmergency = (phrase) => {
    stopSpeaking();
    const text = typeof phrase === "object" ? phrase?.sentence || "" : String(phrase || "").trim();
    if (!text) return;
    const tok = ++speakToken.current;
    setSpeaking(true);
    speak(text, "en", () => { if (speakToken.current === tok) setSpeaking(false); });
    setLog((l) => [text, ...l].slice(0, 3));
  };

  const emergencyActive = live && mode === "EMERGENCY";
  return (
    <div className={emergencyActive ? "mudra-app emergency-active" : "mudra-app"}>
      <header>
        <div className="logo"><i /> MUDRA</div>
        <div className="status"><b>■</b> {emergencyActive ? "EMERGENCY MODE ACTIVE" : `Core online / ${live ? "Live" : "Demo mode"}`}</div>
        <div className="ctrl">
          <button className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      <main>
        <aside>
          <section className="card">
            <h3><span>01 Input telemetry</span><b>115200 baud</b></h3>
            <div className="body">
              <pre>{JSON.stringify({ gesture: packet.gesture || "NONE", flex: packet.flex, confidence: +packet.confidence.toFixed(3) }, null, 2)}</pre>
              <div className="bars">
                {packet.flex.map((v, i) => (
                  <div key={i} className="bar" style={{ height: `${Math.max(4, v)}%` }}>
                    <span>{FINGERS[i]}</span>
                  </div>
                ))}
              </div>
              <button className="btn" style={{ marginTop: 26 }} onClick={simulate}>Pulse (simulate glove)</button>
            </div>
          </section>

          <section className="card">
            <h3><span>02 Signal map</span><b>{history.length ? "Live" : "Idle"}</b></h3>
            <div className="body" style={{ height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <YAxis domain={[0, 100]} hide />
                  <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h3><span>03 Recognition</span><b>{label || "Ready"}</b></h3>
            <div className="body">
              <pre>
                {label === "UNKNOWN"
                  ? "UNKNOWN: no word added"
                  : label ? `accepted: ${label}` : "Waiting for gesture…"}
                {useLLM && words.length
                  ? sentence ? `\nsentence: ${sentence.source}\nlatency: ${sentence.ms} ms` : busy ? "\nsentence: writing…" : "\nsentence: server off, raw words"
                  : ""}
              </pre>
            </div>
          </section>

          <section className="card diagnostic-card">
            <h3><span>04 Live Pipeline Diagnostics</span><b>{telemetry ? "ESP32 Active" : "Waiting for Hardware"}</b></h3>
            <div className="body" style={{ fontSize: "0.82rem", lineHeight: "1.4" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px" }}>
                <div>
                  <strong>ESP32 Ingestion:</strong>{" "}
                  {telemetry ? (
                    <span style={{ color: "var(--accent, #00d26a)" }}>
                      Packets arriving (Seq #{telemetry.seq}, Mode {telemetry.mode})
                    </span>
                  ) : (
                    <span style={{ color: "#888" }}>No packets received yet on UDP 5005</span>
                  )}
                </div>
                <div>
                  <strong>Real Flex Contacts:</strong>{" "}
                  {packet.rawFingers ? (
                    <span>
                      T:{packet.rawFingers.thumb ? "1" : "0"} I:{packet.rawFingers.index ? "1" : "0"} M:{packet.rawFingers.middle ? "1" : "0"} R:{packet.rawFingers.ring ? "1" : "0"} L:{packet.rawFingers.little ? "1" : "0"}
                    </span>
                  ) : (
                    <span>{packet.flex.map((v, i) => `${FINGERS[i]}:${v > 50 ? 1 : 0}`).join(" ")}</span>
                  )}
                </div>
                <div>
                  <strong>Ultrasonic Distance:</strong>{" "}
                  {telemetry?.ultrasonic?.distance_cm != null ? (
                    <span>
                      {Number(telemetry.ultrasonic.distance_cm).toFixed(1)} cm ({telemetry.distance_state || `Zone ${telemetry.ultrasonic.zone}`})
                    </span>
                  ) : (
                    <span>N/A</span>
                  )}
                </div>
                <div>
                  <strong>Module 2 Window:</strong>{" "}
                  <span>State: {telemetry?.m2State || "IDLE"} {telemetry?.m2LastEvent ? `(${telemetry.m2LastEvent})` : ""}</span>
                </div>
                <div>
                  <strong>Module 3 Recognition:</strong>{" "}
                  <span>{diagStatus?.status || (kw ? "MATCH" : "Ready")} {kw ? `→ "${kw.words.join(", ")}"` : ""}</span>
                </div>
                <div>
                  <strong>WebSocket (Port 8080):</strong>{" "}
                  <span style={{ color: live ? "var(--accent, #00d26a)" : "#e05252" }}>
                    {live ? "Connected" : "Disconnected"}
                  </span>
                </div>
                <div>
                  <strong>Module 4 (Port 3000):</strong>{" "}
                  <span>
                    {busy ? "Generating sentence..." : sentence ? `OK (${sentence.source}, ${sentence.ms}ms)` : "Ready"}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </aside>

        <section className="stage">
          {emergencyActive && <div className="emergency-banner" role="alert">🚨 EMERGENCY MODE ACTIVE — DIRECT GESTURE COMMUNICATION</div>}
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "main"} className={`tab ${tab === "main" ? "active" : ""}`} onClick={() => setTab("main")}>
              Main{queue.length ? ` (${queue.length})` : ""}
            </button>
            <button role="tab" aria-selected={tab === "custom"} className={`tab ${tab === "custom" ? "active" : ""}`} onClick={() => setTab("custom")}>Custom gestures</button>
            <button role="tab" aria-selected={tab === "emergency"} className={`tab ${tab === "emergency" ? "active" : ""}`} onClick={() => setTab("emergency")}>Emergency</button>
          </div>

          {tab === "main" && (
            <>
              <div className="main-dashboard"><div className="main-primary">
                <div className="eyebrow">
                  <span>Phrase queue / review before speaking</span>
                  <span className={`badge ${label === "UNKNOWN" ? "warn" : ""}`}>
                    {label === "UNKNOWN" ? "UNKNOWN" : `${(packet.confidence * 100 || 0).toFixed(1)}% match`}
                  </span>
                </div>

                <div className="queue" aria-label="Phrase queue">
                  {queue.length === 0 && <span className="muted">Queue is empty</span>}
                  {queue.map((q) => (
                    <button key={q.id} className="chip word" title="Remove this word" onClick={() => setQueue((x) => x.filter((i) => i.id !== q.id))}>
                      {q.word} ×
                    </button>
                  ))}
                </div>

                <p className="big" aria-live="polite">
                  <AnimatePresence mode="wait">
                    <motion.span key={shown} style={{ display: "inline" }}>
                      {shown.split(" ").map((w, i) => (
                        <motion.span key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.25 }} style={{ display: "inline-block", marginRight: "0.28em" }}>
                          {w}
                        </motion.span>
                      ))}
                    </motion.span>
                  </AnimatePresence>
                </p>

                <div className="row">
                  <button className="btn solid" disabled={!words.length || speaking || busy || mode === "EMERGENCY"} onClick={onSpeak}>
                    {speaking ? "Speaking…" : busy ? "Writing…" : "Speak"}
                  </button>
                  <button className="btn" disabled={!speaking} onClick={onStop}>Stop</button>
                  <button className="btn" disabled={!words.length} onClick={() => setQueue([])}>Clear</button>
                  <button className={`btn ${useLLM ? "on" : ""}`} aria-pressed={useLLM} onClick={() => setUseLLM(!useLLM)} title="Turn LLM sentence on or off">
                    Sentence: {useLLM ? "On" : "Off"}
                  </button>
                  <button className="btn" disabled={!words.length} onClick={() => setQueue((q) => q.slice(0, -1))}>Undo word</button>
                </div>

                <div className="row">
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addWord(typed); setTyped(""); } }} placeholder="Type a word (testing without glove)" aria-label="Add word manually" />
                  <button className="btn" onClick={() => { addWord(typed); setTyped(""); }}>Add</button>
                </div>
                <div className="chips">
                  {BASE_GESTURES.map((c) => (
                    <button key={c} className="chip" onClick={() => addWord(c)}>{c}</button>
                  ))}
                </div>
                <section className="translation-section" aria-label="Multilingual communication">
                  <div className="eyebrow"><span>Multilingual communication</span><span>English · हिंदी · Hinglish</span></div>
                  <div className="translation-grid">
                    <div className="translation-card">
                      <div className="translation-head"><b>ENGLISH</b><span>01</span></div>
                      <p>{words.length ? shown : "Awaiting gesture…"}</p>
                      <button className="btn" disabled={!words.length || speaking || busy || emergencyActive} onClick={() => speakText(shown, "en")}>▶ Speak English</button>
                    </div>
                    <div className="translation-card">
                      <div className="translation-head"><b>हिंदी</b><span>02</span></div>
                      <p className="hindi">{translations?.hindi || (translationState === "loading" ? "अनुवाद हो रहा है…" : translationState === "error" ? "Translation unavailable" : "हिंदी अनुवाद यहाँ दिखेगा")}</p>
                      <button className="btn" disabled={!translations?.hindi || speaking || emergencyActive} onClick={() => speakText(translations.hindi, "hi")}>▶ Speak Hindi</button>
                    </div>
                    <div className="translation-card">
                      <div className="translation-head"><b>HINGLISH</b><span>03</span></div>
                      <p>{translations?.hinglish || (translationState === "loading" ? "Translating…" : translationState === "error" ? "Translation unavailable" : "Hinglish appears here")}</p>
                      <button className="btn" disabled={!translations?.hinglish || speaking || emergencyActive} onClick={() => speakText(translations.hinglish, "hinglish")}>▶ Speak Hinglish</button>
                    </div>
                  </div>
                </section>
              </div><div className="main-side">
                  <section className="card"><h3><span>Live system</span><b>{live ? "Connected" : "Demo / Offline"}</b></h3>
                    <div className="body system-lines">
                      <div><span>Module 3 WebSocket</span><b>{live ? "LIVE" : "NOT CONNECTED"}</b></div>
                      <div><span>Communication mode</span><b>{mode}</b></div>
                      <div><span>Module 4</span><b>{busy ? "GENERATING" : sentence?.source || "READY / UNTESTED"}</b></div>
                      <div><span>Translation</span><b>{translationState.toUpperCase()}</b></div>
                      <div><span>Queue length</span><b>{queue.length}</b></div>
                    </div>
                  </section>
                  <section className="card"><h3><span>Recent phrases</span><b>{log.length}</b></h3>
                    <div className="body recent-list">{log.length ? log.map((l, i) => <div key={i} className="recent-item"><span>{l}</span><button className="btn" disabled={speaking || emergencyActive} onClick={() => speakText(l, /[\u0900-\u097F]/.test(l) ? "hi" : "en")}>Replay</button></div>) : <p className="muted">Spoken phrases will appear here.</p>}</div>
                  </section>
                  <section className="card"><h3><span>Recognition activity</span><b>{history.length} samples</b></h3>
                    <div className="body"><p className="muted">Latest gesture</p><strong>{label || "WAITING"}</strong><p className="muted">Confidence: {(packet.confidence * 100 || 0).toFixed(1)}%</p></div>
                  </section>
                </div></div>
            </>
          )}

          {tab === "custom" && (
            <>
              <div className="eyebrow">
                <span>Custom gestures</span>
                <span>Slots used {customs.length} / {CUSTOM_LIMIT}</span>
              </div>
              <p className="muted" style={{ margin: "10px 0 16px" }}>
                Write your own gesture name and, if you want, a fixed sentence. Add to queue sends the name to the Main tab. Speak says the fixed sentence at once.
              </p>

              {customs.length === 0 && <p className="muted">No custom gestures yet. Add one below.</p>}
              {customs.map((c, n) => (
                <div key={c.id} className="slot">
                  <span className="n">{n + 1}</span>
                  <div className="info">
                    <b>{c.label}</b>
                    <span className="muted">{c.phrase ? `says: ${c.phrase}` : "sentence made by the LLM"}</span>
                  </div>
                  <button className="btn" onClick={() => addWord(c.label)}>Add to queue</button>
                  {c.phrase && <button className="btn" onClick={() => onEmergency(c.phrase)}>Speak</button>}
                  <button className="btn" title="Remove" aria-label={`Remove ${c.label}`} onClick={() => setCustoms((x) => x.filter((i) => i.id !== c.id))}>×</button>
                </div>
              ))}

              <div className="row" style={{ marginTop: 18 }}>
                <input value={cName} onChange={(e) => setCName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()} placeholder="Gesture name (e.g. CHAI)" aria-label="Custom gesture name" disabled={customs.length >= CUSTOM_LIMIT} />
                <input value={cPhrase} onChange={(e) => setCPhrase(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()} placeholder="Fixed sentence (optional)" aria-label="Fixed sentence" disabled={customs.length >= CUSTOM_LIMIT} style={{ textTransform: "none" }} />
                <button className="btn solid" onClick={addCustom} disabled={!cName.trim() || customs.length >= CUSTOM_LIMIT}>Add</button>
              </div>
              {customs.length >= CUSTOM_LIMIT && <p className="muted">All {CUSTOM_LIMIT} slots are used. Remove one to add another.</p>}
            </>
          )}

          {tab === "emergency" && (
            <>
              <div className="eyebrow"><span>Emergency Mode</span><span>Module 3 direct recognition</span></div>
              <div className="card" style={{ marginTop: 16 }}>
                <div className="body">
                  <div className="row">
                    <button
                      className={`btn ${mode === "EMERGENCY" ? "on" : "solid"}`}
                      disabled={!live || modePending}
                      aria-pressed={mode === "EMERGENCY"}
                      onClick={() => changeMode(mode !== "EMERGENCY")}
                    >
                      {modePending ? "Waiting for Module 3…" : mode === "EMERGENCY" ? "Turn Emergency OFF" : "Turn Emergency ON"}
                    </button>
                  </div>
                  <p role="status" className="muted" style={{ marginTop: 12 }}>
                    {!live ? "Module 3 disconnected — mode unconfirmed" : modePending ? "Waiting for mode acknowledgement…" : mode === "EMERGENCY" ? "🚨 EMERGENCY MODE ACTIVE" : mode === "NORMAL" ? "NORMAL MODE ACTIVE" : "Connected — mode not yet confirmed"}
                  </p>
                  {modeError && <p role="alert" style={{ marginTop: 8 }}>{modeError}</p>}
                  {live && mode === "EMERGENCY" && !modePending && (
                    <div style={{ marginTop: 20 }}>
                      <p className="big" aria-live="polite">
                        {emergencySentence?.sentence
                          ? `🚨 ${emergencySentence.sentence}`
                          : "Waiting for emergency gesture…"}
                      </p>

                      <div className="row">
                        <button
                          className="btn solid"
                          disabled={!emergencySentence?.sentence || speaking}
                          onClick={() => onEmergency(emergencySentence.sentence)}
                        >
                          {speaking ? "Speaking…" : "Speak"}
                        </button>

                        <button
                          className="btn"
                          disabled={!speaking}
                          onClick={onStop}
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}