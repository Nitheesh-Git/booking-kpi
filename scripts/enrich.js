/**
 * enrich: tag every pending review with AI topics.
 * Usage: npm run enrich
 */

import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { PROMPT_VERSION_KEY } from "../lib/enrich.js";
import { enrichPending } from "../lib/enrich-runner.js";
import { resolvedLlmKeys } from "../lib/llm.js";

const environment = loadEnvironment();
const keys = resolvedLlmKeys(environment);
if (!keys.groq.length && !keys.openrouter.length) {
  console.error("No LLM keys configured (GROQ_API_KEYS or OPENROUTER_API_KEYS).");
  process.exit(1);
}

console.log(`Starting enrichment, prompt version ${PROMPT_VERSION_KEY}`);
const totals = await enrichPending(createDatabaseClient(environment), keys, {
  onProgress: (ok) => process.stdout.write(ok ? "." : "!"),
});
console.log(
  `\nEnrichment complete: ${totals.done} done, ${totals.failed} failed, ${totals.skipped} skipped, ${totals.droppedTags} tags dropped by the evidence check.`,
);
if (totals.failed) process.exitCode = 1;
