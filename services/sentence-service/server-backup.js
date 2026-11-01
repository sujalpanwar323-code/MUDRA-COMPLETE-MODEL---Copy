// Module 4: keywords -> LLM sentence (1.2 s budget) -> cache -> emergency fallback.
// Text-to-speech happens in the browser (Speak button), not here.
// Default LLM: local Ollama (no internet, no credit). Just run:  npm start
// Optional second LLM (pick with LLM_PROVIDER):
//   Anthropic API (needs key + credit):
//     Windows (cmd), one command per line:
//       set LLM_PROVIDER=anthropic
//       set ANTHROPIC_API_KEY=your_key
//       npm start
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 3000;
// Default is the local Ollama model (team decision). Set LLM_PROVIDER=anthropic (plus ANTHROPIC_API_KEY) to use the API instead.
const PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
const BUDGET_MS = Number(process.env.BUDGET_MS) || 1200; // team rule: LLM must answer within ~1.2 s or we fall back
const MODEL = "claude-haiku-5-5";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Allow the React app (localhost:5173) to call this server.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const client = PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const llmOn = PROVIDER === "ollama" || Boolean(client);
if (!llmOn) console.warn("No LLM configured: server will use cache/fallback only.");
console.log(`LLM provider: ${PROVIDER}${PROVIDER === "ollama" ? ` (${OLLAMA_MODEL})` : ""}, budget ${BUDGET_MS} ms`);

// Team lead's prompt for Module 4 (kept verbatim; Hindi is an optional extra line).
const SYSTEM_PROMPT = `You are the sentence construction module for MUDRA, an assistive communication system that converts recognized sign-language gesture keywords into clear, natural sentences.

Your task:
Convert the ordered list of recognized keywords provided by Module 3 into a grammatically correct sentence while preserving the user's intended meaning.

Rules:
1. Preserve the order and meaning of the input keywords as much as possible.
2. Correct grammar and word order where necessary to produce natural English.
3. Add only the minimum grammatical words needed to form a coherent sentence.
4. Never invent names, people, objects, actions, emotions, requests, or contextual details that are not supported by the input.
5. Do not add explanations, alternatives, introductions, or commentary.
6. If the keywords already form a valid sentence, return it with appropriate capitalization and punctuation.
7. If the input is ambiguous or incomplete, produce the most conservative interpretation possible. Do not guess missing context.
8. If the input is empty or unusable, return: "Sorry, I could not understand the gesture sequence."

Output format:
Return only the final sentence as plain text. Do not return JSON, markdown, or any other formatting.`;

const NO_UNDERSTAND = "Sorry, I could not understand the gesture sequence.";
// Extra guidance added after the first test run on the 1.5B model (it copied keywords in CAPS,
// dropped "I"/"my", and gave commands like "Go home now."). Show this block to the team lead.
// The examples below are deliberately different from the 10 test cases in test_cases.json.
const EXTRA_GUIDANCE = `

Additional guidance:
- The keywords come from the person who is signing. Write the sentence in their own voice: use "I", "my" and "me" where natural, or a polite request ("Please ...") or a direct question.
- Use normal sentence capitalization. Never copy keywords in capital letters.
- Always return a complete sentence, not a fragment.

Examples (keywords -> sentence):
["tea", "want"] -> I want tea.
["doctor", "call"] -> Please call the doctor.
["bus", "stop", "where"] -> Where is the bus stop?
["tired", "sleep"] -> I am tired and want to sleep.
["stomach", "pain"] -> My stomach hurts.
["sit", "please"] -> Please sit.`;
const systemFor = (langName) =>
  SYSTEM_PROMPT + EXTRA_GUIDANCE + (langName === "Hindi" ? "\n\nWrite the sentence in Hindi instead of English." : "");
// Keywords go in lowercase so the model does not copy capital letters into the sentence.
const userFor = (words) => `Keywords: ${JSON.stringify(words.map((w) => w.toLowerCase()))}`;

// Small models sometimes add quotes or extra lines; keep only the first clean line.
const cleanup = (t) =>
  String(t).trim().split("\n")[0].trim().replace(/^["'`]+|["'`]+$/g, "").trim();

async function askOllama(words, langName, signal) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: "30m", // keep the model in RAM so later calls are fast
      options: { num_predict: 60, temperature: 0 },
      messages: [
        { role: "system", content: systemFor(langName) },
        { role: "user", content: userFor(words) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const data = await r.json();
  return cleanup(data.message.content);
}

// Warm-up: the first Ollama call loads the model and is slow. Do it at startup, not during the demo.
if (PROVIDER === "ollama") {
  askOllama(["HELLO"], "English", AbortSignal.timeout(60000))
    .then(() => console.log("Ollama model warmed up"))
    .catch((e) => console.warn("Ollama warm-up failed (is `ollama serve` running and the model pulled?):", e.message));
}

// ---- Memory block: remembers sentences already generated ----
const cache = new Map(); // "en|HELLO WATER" -> sentence

// ---- Fallback phrases (critical/emergency first), used when the LLM is slow or down ----
const FALLBACK = {
  "NEED WATER": { en: "I need water." },
  "MEDICINE NEED": { en: "I need medicine." },
  "WASHROOM WHERE ME": { en: "Where is the washroom?" },
  "HUNGRY FOOD NEED": { en: "I am hungry and need food." },
  "HELP NEED PLEASE": { en: "Please help me." },
  "HEAD PAIN": { en: "My head hurts." },
  "WAIT PLEASE TWO MINUTE": { en: "Please wait two minutes." },
  "GO HOME NOW": { en: "I want to go home now." },
  "THIRSTY WATER": { en: "I am thirsty. Please give me water." },
  "HELP HOSPITAL URGENT": { en: "I need urgent help getting to a hospital." },
  "HELP NEED": { en: "I need help, please come here.", hi: "मुझे मदद चाहिए, कृपया यहाँ आइए।" },
  "HELP": { en: "Please help me.", hi: "कृपया मेरी मदद कीजिए।" },
  "PAIN": { en: "I am in pain, please call a doctor.", hi: "मुझे दर्द है, कृपया डॉक्टर को बुलाइए।" },
  "WATER": { en: "I need some water, please.", hi: "मुझे पानी चाहिए, कृपया।" },
  "HELLO WATER": { en: "Hello, could I please have some water?", hi: "नमस्ते, क्या मुझे थोड़ा पानी मिल सकता है?" },
  "THANK YOU": { en: "Thank you so much for your help.", hi: "आपकी मदद के लिए बहुत धन्यवाद।" },
  "HELLO": { en: "Hello, it's nice to meet you.", hi: "नमस्ते, आपसे मिलकर अच्छा लगा।" },
};

// POST /sentence  { "keywords": "HELLO WATER", "lang": "en" | "hi" }
// -> { sentence, source: "cache" | "llm" | "fallback" | "raw", ms }
app.post("/sentence", async (req, res) => {
  const t0 = Date.now();
  // Module 3 may send an array (["NEED","WATER"]) or a string ("NEED WATER").
  const raw = req.body.keywords;
  const words = (Array.isArray(raw) ? raw : String(raw || "").split(/\s+/))
    .map((w) => String(w).trim().toUpperCase())
    .filter(Boolean);
  const keywords = words.join(" ");
  const langKey = req.body.lang === "hi" ? "hi" : "en";
  const langName = langKey === "hi" ? "Hindi" : "English";

  const send = (sentence, source) => {
    const ms = Date.now() - t0;
    console.log(`[${source}] ${langKey} "${keywords}" -> ${ms} ms`);
    res.json({ sentence, source, ms });
  };

  if (!words.length) return send(NO_UNDERSTAND, "fallback"); // rule 8: empty/unusable input

  const key = `${langKey}|${keywords}`;
  if (!req.body.nocache && cache.has(key)) return send(cache.get(key), "cache");

  const fallback = () => {
    const f = FALLBACK[keywords];
    return f ? send(f[langKey] || f.en, "fallback") : send(keywords.toLowerCase(), "raw");
  };

  if (!llmOn) return fallback();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), BUDGET_MS);
  try {
    let sentence;
    if (PROVIDER === "ollama") {
      sentence = await askOllama(words, langName, ctl.signal);
    } else {
      const reply = await client.messages.create(
        { model: MODEL, max_tokens: 60, temperature: 0, system: systemFor(langName), messages: [{ role: "user", content: userFor(words) }] },
        { signal: ctl.signal }
      );
      sentence = cleanup(reply.content[0].text);
    }
    if (!sentence) throw new Error("empty reply");
    cache.set(key, sentence);
    send(sentence, "llm");
  } catch (err) {
    console.error("LLM failed or timed out:", err.name === "AbortError" ? `> ${BUDGET_MS} ms` : err.message);
    fallback();
  } finally {
    clearTimeout(timer);
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, llm: llmOn, provider: PROVIDER, cached: cache.size }));

app.listen(PORT, () => console.log(`Module 4 running at http://localhost:${PORT}`));
