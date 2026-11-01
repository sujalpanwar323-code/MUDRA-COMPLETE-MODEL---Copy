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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localEnv = path.join(__dirname, ".env");
if (fs.existsSync(localEnv) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(localEnv); } catch (_) {}
}

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

let ollamaAvailable = false;
let ollamaModelInstalled = false;

async function checkOllamaHealth() {
  if (PROVIDER !== "ollama") return;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json();
      ollamaAvailable = true;
      const models = (data.models || []).map((m) => m.name);
      ollamaModelInstalled = models.some((m) => m.includes(OLLAMA_MODEL));
      console.log(`[MODULE 4] Ollama reachable. Model '${OLLAMA_MODEL}' installed: ${ollamaModelInstalled}`);
    } else {
      ollamaAvailable = false;
      ollamaModelInstalled = false;
    }
  } catch (_) {
    ollamaAvailable = false;
    ollamaModelInstalled = false;
  }
}

// Warm-up & health check:
if (PROVIDER === "ollama") {
  checkOllamaHealth().then(() => {
    if (ollamaAvailable && ollamaModelInstalled) {
      askOllama(["HELLO"], "English", AbortSignal.timeout(10000))
        .then(() => console.log("Ollama model warmed up"))
        .catch((e) => console.warn("Ollama warm-up warning:", e.message));
    } else {
      console.log(`[MODULE 4] Ollama is not running or model '${OLLAMA_MODEL}' not loaded. Using deterministic fallback dictionary.`);
    }
  });
  setInterval(checkOllamaHealth, 30000).unref();
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

  if (!llmOn || (PROVIDER === "ollama" && !ollamaAvailable)) return fallback();

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

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    llm: PROVIDER === "ollama" ? (ollamaAvailable && ollamaModelInstalled) : llmOn,
    provider: PROVIDER,
    ollamaAvailable,
    ollamaModelInstalled,
    model: OLLAMA_MODEL,
    cached: cache.size
  })
);




// Optional multilingual output: a separate call so translation never blocks /sentence.
// Do not reuse the 1200ms sentence budget for translation.
const TRANSLATE_TIMEOUT_MS = 7000;
const translationCache = new Map();
const TRANSLATION_SYSTEM = `Translate the user's English sentence for an assistive communication device.
Return ONLY one valid JSON object with exactly two string properties: "hindi" and "hinglish".
"hindi": natural Hindi in Devanagari script.
"hinglish": natural conversational Hindi in Latin letters, optionally with common English words.
Preserve the original meaning and speaker perspective. Do not invent details.
Do not add markdown, explanations, or other keys.`;

app.post("/translate", async (req, res) => {
  const sentence = typeof req.body?.sentence === "string" ? req.body.sentence.trim() : "";
  if (!sentence || sentence.length > 500) return res.status(400).json({ error: "Provide a sentence of 1–500 characters" });
  if (translationCache.has(sentence)) return res.json(translationCache.get(sentence));
  if (!llmOn) return res.status(503).json({ error: "Translation model unavailable" });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    let raw;
    if (PROVIDER === "ollama") {
      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({
          model: OLLAMA_MODEL, stream: false, keep_alive: "30m",
          format: "json", options: { num_predict: 220, temperature: 0 },
          messages: [
            { role: "system", content: TRANSLATION_SYSTEM },
            { role: "user", content: sentence },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
      raw = (await r.json()).message?.content;
    } else {
      const reply = await client.messages.create({
        model: MODEL, max_tokens: 250, temperature: 0,
        system: TRANSLATION_SYSTEM,
        messages: [{ role: "user", content: sentence }],
      }, { signal: ctl.signal });
      raw = reply.content?.find((x) => x.type === "text")?.text;
    }
    const parsed = JSON.parse(String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
    if (typeof parsed.hindi !== "string" || typeof parsed.hinglish !== "string" ||
        !parsed.hindi.trim() || !parsed.hinglish.trim()) throw new Error("Invalid translation response");
    const result = { hindi: parsed.hindi.trim(), hinglish: parsed.hinglish.trim() };
    translationCache.set(sentence, result);
    res.json(result);
  } catch (err) {
    console.error("Translation failed:", err.message);
    res.status(503).json({ error: "Translation unavailable" });
  } finally { clearTimeout(timer); }
});

const httpServer = app.listen(PORT, () => console.log(`Module 4 running at http://localhost:${PORT}`));
httpServer.on("error", (error) => {
  const reason = error.code === "EADDRINUSE"
    ? `HTTP port ${PORT} is already in use`
    : error.message;
  console.error(`[MODULE 4 STARTUP ERROR] ${reason} (${error.code || "server error"})`);
  process.exitCode = 1;
});

function shutdown() {
  if (!httpServer.listening) {
    if (process.connected) process.disconnect();
    return;
  }
  httpServer.close(error => {
    if (error) {
      console.error(`[MODULE 4 SHUTDOWN ERROR] ${error.message}`);
      process.exitCode = 1;
    }
    if (process.connected) process.disconnect();
  });
}

process.on("message", message => {
  if (message && message.type === "shutdown") shutdown();
});
process.once("SIGINT", shutdown);

export { httpServer };
