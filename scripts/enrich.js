/**
 * Batch enrichment runner.
 *
 * Processes all review_enrichment rows with status='pending',
 * calls the LLM, and writes results to review_enrichment + review_topics.
 *
 * Features:
 *  • Per-review error isolation — one failure never stops others
 *  • Bounded rate with inter-request delay and backoff on rate-limits
 *  • Idempotent — skips reviews already enriched with the same prompt version
 *  • Skips reviews with no enrichable text without calling the LLM
 *  • Progress dots to stdout
 */

import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { enrichReview, PROMPT_VERSION_KEY } from "../lib/enrich.js";
import { callLlm, resolvedLlmKeys } from "../lib/llm.js";

const CONCURRENCY = 1;
const BATCH_SIZE = 30;
const INTER_REQUEST_DELAY_MS = 1000;
const RATE_LIMIT_BACKOFF_MS = 10000;

const environment = loadEnvironment();
const database = createDatabaseClient(environment);
const llmKeys = resolvedLlmKeys(environment);

if (!llmKeys.groq.length && !llmKeys.openrouter.length) {
  throw new Error(
    "No LLM keys configured (GROQ_API_KEYS or OPENROUTER_API_KEYS)",
  );
}

// ── Database helpers ──────────────────────────────────────────────────────

/** Fetch one batch of pending enrichment rows with review text. */
async function fetchPendingBatch() {
  const { data, error } = await database
    .from("review_enrichment")
    .select(
      `review_id,
       attempts,
       reviews!inner (
         id,
         title,
         liked_text,
         disliked_text
       )`,
    )
    .eq("status", "pending")
    .lt("attempts", 3)
    .order("attempts", { ascending: true })
    .order("review_id", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  return data ?? [];
}

/** Persist a successful enrichment result. */
async function saveEnrichment(reviewId, result) {
  const { sentimentScore, topics, provider, model } = result;

  const { error: updateError } = await database
    .from("review_enrichment")
    .update({
      status: "done",
      provider,
      model,
      prompt_version: PROMPT_VERSION_KEY,
      sentiment_score: sentimentScore,
      enriched_at: new Date().toISOString(),
      error: null,
    })
    .eq("review_id", reviewId);
  if (updateError) throw updateError;

  if (topics.length) {
    // Delete stale topic rows then insert fresh ones (idempotent replace).
    const { error: deleteError } = await database
      .from("review_topics")
      .delete()
      .eq("review_id", reviewId);
    if (deleteError) throw deleteError;

    const { error: insertError } = await database
      .from("review_topics")
      .insert(topics.map((t) => ({ review_id: reviewId, ...t })));
    if (insertError) throw insertError;
  }
}

/** Persist a failure and increment the attempt counter. */
async function saveFailure(reviewId, error, currentAttempts) {
  const newAttempts = currentAttempts + 1;
  const { error: updateError } = await database
    .from("review_enrichment")
    .update({
      status: newAttempts >= 3 ? "failed" : "pending",
      attempts: newAttempts,
      error: (error.message ?? "Unknown error").slice(0, 500),
    })
    .eq("review_id", reviewId);
  if (updateError)
    console.error("Could not persist failure:", updateError.message);
}

/** Mark a review as skipped (no enrichable text). */
async function markSkipped(reviewId) {
  await database
    .from("review_enrichment")
    .update({ status: "skipped", prompt_version: PROMPT_VERSION_KEY })
    .eq("review_id", reviewId);
}

// ── Processing ────────────────────────────────────────────────────────────

/** Process a single review_enrichment row. */
async function processOne(row) {
  const review = row.reviews;
  const reviewId = row.review_id;
  try {
    const result = await enrichReview(
      {
        title: review.title,
        likedText: review.liked_text,
        dislikedText: review.disliked_text,
      },
      (prompt, options) => callLlm(llmKeys, prompt, options),
    );
    await saveEnrichment(reviewId, result);
    await new Promise((resolve) => setTimeout(resolve, INTER_REQUEST_DELAY_MS));
    return { ok: true, reviewId };
  } catch (error) {
    const isRateLimit =
      error.message?.includes("rate-limited") ||
      error.message?.includes("429");
    if (isRateLimit) {
      console.warn("\n[Rate limit hit, pausing for cooldown...]");
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_BACKOFF_MS),
      );
    }
    await saveFailure(reviewId, error, row.attempts ?? 0);
    return { ok: false, reviewId, error: error.message };
  }
}

/** Run tasks with bounded concurrency. */
async function withConcurrency(items, fn, limit) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      results.push(await fn(item));
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// ── Main loop ─────────────────────────────────────────────────────────────

const totals = { done: 0, failed: 0, skipped: 0 };
const attemptedInRun = new Set();

console.log(`Starting enrichment prompt_version=${PROMPT_VERSION_KEY}`);

for (;;) {
  const batch = await fetchPendingBatch();
  const unattempted = batch.filter((r) => !attemptedInRun.has(r.review_id));
  if (!unattempted.length) break;

  const enrichable = [];
  for (const row of unattempted) {
    attemptedInRun.add(row.review_id);
    const r = row.reviews;
    if (!r.title && !r.liked_text && !r.disliked_text) {
      await markSkipped(row.review_id);
      totals.skipped += 1;
    } else {
      enrichable.push(row);
    }
  }

  if (enrichable.length) {
    const results = await withConcurrency(enrichable, processOne, CONCURRENCY);
    for (const r of results) {
      if (r.ok) {
        totals.done += 1;
        process.stdout.write(".");
      } else {
        totals.failed += 1;
        process.stdout.write("!");
      }
    }
    process.stdout.write("\n");
  }
}

console.log(
  `\nEnrichment complete: ${totals.done} done, ${totals.failed} failed, ${totals.skipped} skipped.`,
);
if (totals.failed) process.exit(1);
