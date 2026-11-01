// Runs the team lead's test cases against the running server and prints expected vs actual.
// 1) Start the server in one terminal (npm start)   2) In a second terminal: npm test
import { readFileSync } from "node:fs";
const ENDPOINT = process.env.ENDPOINT || "http://localhost:3000/sentence";
const { test_cases } = JSON.parse(readFileSync(new URL("./test_cases.json", import.meta.url)));
const norm = (t) => t.toLowerCase().replace(/[^a-z ]/g, "").trim();
let match = 0, llm = 0;
for (const c of test_cases) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords: c.keywords, lang: "en", nocache: true }),
  });
  const d = await r.json();
  const ok = norm(d.sentence) === norm(c.expected_output);
  const tag = d.source === "llm" ? (ok ? "MATCH " : "DIFF  ") : "NO-LLM";
  if (d.source === "llm") llm++;
  if (ok && d.source === "llm") match++;
  console.log(`#${c.id} ${tag} [${d.source}] ${d.ms} ms  ${c.keywords.join(" ")}`);
  console.log(`     expected: ${c.expected_output}`);
  console.log(`     got:      ${d.sentence}`);
}
console.log(`\n${llm}/${test_cases.length} answered by the LLM, ${match} of those matched exactly.`);
if (llm < test_cases.length) console.log("Some answers came from [fallback] or [raw], not the LLM: the LLM failed or took over the time budget. Those do NOT count as passes.");
console.log("A DIFF can still be fine if the wording differs but the meaning is right.");
