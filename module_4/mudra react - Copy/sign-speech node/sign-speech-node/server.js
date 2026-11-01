// Module 4: keywords -> LLM sentence (1.2 s budget) -> cache -> emergency fallback.
// Text-to-speech happens in the browser (Speak button), not here.
// Run: npm install, then set ANTHROPIC_API_KEY and run npm start
//   Windows (cmd):        set ANTHROPIC_API_KEY=your_key   (then, on the next line) npm start
//   Windows (PowerShell): $env:ANTHROPIC_API_KEY="your_key"; npm start
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 3000;
const BUDGET_MS = 1200; // team rule: LLM must answer within ~1.2 s or we fall back
const MODEL = "claude-haiku-5-5";

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

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
if (!client) console.warn("No ANTHROPIC_API_KEY set: server will use cache/fallback only.");

// ---- Memory block: remembers sentences already generated ----
const cache = new Map(); // "en|HELLO WATER" -> sentence

// ---- Fallback phrases (critical/emergency first), used when the LLM is slow or down ----
const FALLBACK = {
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
  const keywords = String(req.body.keywords || "").trim().toUpperCase();
  const langKey = req.body.lang === "hi" ? "hi" : "en";
  const langName = langKey === "hi" ? "Hindi" : "English";
  if (!keywords) return res.status(400).json({ error: "keywords required" });

  const send = (sentence, source) => {
    const ms = Date.now() - t0;
    console.log(`[${source}] ${langKey} "${keywords}" -> ${ms} ms`);
    res.json({ sentence, source, ms });
  };

  const key = `${langKey}|${keywords}`;
  if (cache.has(key)) return send(cache.get(key), "cache");

  const fallback = () => {
    const f = FALLBACK[keywords];
    return f ? send(f[langKey], "fallback") : send(keywords.toLowerCase(), "raw");
  };

  if (!client) return fallback();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), BUDGET_MS);
  try {
    const reply = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 60,
        messages: [{
          role: "user",
          content:
            `You help a speech-impaired person talk. Convert these sign keywords ` +
            `into one short, natural, polite first-person sentence in ${langName}. ` +
            `Output only the sentence.\n\nKeywords: ${keywords}`,
        }],
      },
      { signal: ctl.signal }
    );
    const sentence = reply.content[0].text.trim();
    cache.set(key, sentence);
    send(sentence, "llm");
  } catch (err) {
    console.error("LLM failed or timed out:", err.name === "AbortError" ? `> ${BUDGET_MS} ms` : err.message);
    fallback();
  } finally {
    clearTimeout(timer);
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, llm: Boolean(client), cached: cache.size }));

app.listen(PORT, () => console.log(`Module 4 running at http://localhost:${PORT}`));
