/**
 * eval: measure AI topic tags and the keyword baseline against hand labels.
 *
 * Needs data/eval/golden.json (see `npm run label-template`). Prints
 * precision and recall per topic and polarity, then the failure cases.
 *
 * Usage: npm run eval [-- --failures 20]
 */

import { existsSync, readFileSync } from "node:fs";
import { keywordTags } from "../lib/baseline.js";
import { loadEnvironment } from "../lib/env.js";
import { scoreTags } from "../lib/evaluate.js";
import { createSource } from "../lib/repository.js";

const GOLDEN = "data/eval/golden.json";
if (!existsSync(GOLDEN)) {
  console.error(`${GOLDEN} not found. Run npm run label-template, label the reviews by hand, and save as ${GOLDEN}.`);
  process.exit(1);
}
const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
if (!golden.labelledBy) console.warn("Warning: golden.json has no labelledBy; record who labelled it.");

const source = createSource(loadEnvironment());
if (!source) throw new Error("No data source. Configure Supabase or add data/sample/reviews.json.");
const byId = new Map(
  (await source.loadReviews({ fromUtc: "2000-01-01T00:00:00Z", toUtc: "2100-01-01T00:00:00Z" })).map((r) => [r.id, r]),
);

// Only reviews the AI has actually tagged are a fair test of the AI.
const labelled = golden.reviews.filter((g) => byId.get(g.id)?.enrichmentStatus === "done");
const missing = golden.reviews.length - labelled.length;
const ai = scoreTags(labelled.map((g) => ({ id: g.id, expected: g.labels, predicted: byId.get(g.id).topics })));
const kw = scoreTags(labelled.map((g) => ({ id: g.id, expected: g.labels, predicted: keywordTags(g) })));

const pct = (v) => (v == null ? "  n/a" : `${Math.round(v * 100)}%`.padStart(5));
console.log(`\nEvaluated ${labelled.length} hand-labelled reviews${missing ? ` (${missing} skipped: not found or not yet tagged by the AI)` : ""}.\n`);
console.log(`${"tag".padEnd(26)} ${"AI prec".padStart(8)} ${"AI rec".padStart(7)} ${"KW prec".padStart(8)} ${"KW rec".padStart(7)}  support`);
const tags = [...new Set([...ai.rows, ...kw.rows].map((r) => r.tag))].sort();
for (const tag of tags) {
  const a = ai.rows.find((r) => r.tag === tag) ?? {};
  const k = kw.rows.find((r) => r.tag === tag) ?? {};
  const support = (a.tp ?? 0) + (a.fn ?? 0);
  console.log(`${tag.padEnd(26)} ${pct(a.precision).padStart(8)} ${pct(a.recall).padStart(7)} ${pct(k.precision).padStart(8)} ${pct(k.recall).padStart(7)}  ${support}`);
}
console.log(`${"OVERALL".padEnd(26)} ${pct(ai.overall.precision).padStart(8)} ${pct(ai.overall.recall).padStart(7)} ${pct(kw.overall.precision).padStart(8)} ${pct(kw.overall.recall).padStart(7)}`);

const limit = Number(process.argv.includes("--failures") ? process.argv[process.argv.indexOf("--failures") + 1] : 15);
console.log(`\nAI failure cases (first ${limit}):`);
for (const f of ai.failures.slice(0, limit)) {
  const r = byId.get(f.id);
  console.log(`- ${f.id} [${r.rating}] missed: ${f.missed.join(", ") || "none"} | extra: ${f.extra.join(", ") || "none"}`);
  console.log(`    + ${r.liked ?? ""}\n    - ${r.disliked ?? ""}`);
}
