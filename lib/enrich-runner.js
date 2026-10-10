/**
 * Enrich pending reviews: AI topic tags, sentiment and evidence.
 *
 * Shared by `npm run enrich` (no limits) and the daily cron (small, time-boxed
 * batch so the Vercel function finishes in time). Idempotent: only rows still
 * `pending` are touched, and a review's topics are replaced as a whole.
 * One failing review never stops the others; after 3 attempts it is `failed`.
 */

import { enrichReview, PROMPT_VERSION_KEY } from "./enrich.js";
import { callLlm } from "./llm.js";

const BATCH_SIZE = 30;
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPendingBatch(database, skip) {
  const { data, error } = await database
    .from("review_enrichment")
    .select("review_id, attempts, reviews!inner ( id, title, liked_text, disliked_text )")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("attempts", { ascending: true })
    .order("review_id", { ascending: true })
    // Over-fetch by the rows already tried this run, so they cannot hide the rest.
    .limit(Math.min(BATCH_SIZE + skip, 1000));
  if (error) throw error;
  return data ?? [];
}

const isRateLimit = (failure) => /rate.?limit|429/i.test(failure?.message ?? "");

async function saveEnrichment(database, reviewId, result) {
  const { sentimentScore, topics, provider, model } = result;
  // Replace topics first, so a crash never leaves "done" with stale tags.
  const { error: deleteError } = await database.from("review_topics").delete().eq("review_id", reviewId);
  if (deleteError) throw deleteError;
  if (topics.length) {
    const { error: insertError } = await database
      .from("review_topics")
      .insert(topics.map((t) => ({ review_id: reviewId, ...t })));
    if (insertError) throw insertError;
  }
  const { error } = await database
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
  if (error) throw error;
}

async function saveFailure(database, reviewId, failure, attempts) {
  const next = attempts + 1;
  const { error } = await database
    .from("review_enrichment")
    .update({
      status: next >= MAX_ATTEMPTS ? "failed" : "pending",
      attempts: next,
      error: String(failure.message ?? "Unknown error").slice(0, 500),
    })
    .eq("review_id", reviewId);
  if (error) console.error(`Could not record enrichment failure: ${error.message}`);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} database
 * @param {{ groq: string[]; openrouter: string[] }} keys
 * @param {{ maxReviews?: number; deadlineMs?: number; delayMs?: number; backoffMs?: number; onProgress?: (ok: boolean) => void; llm?: typeof callLlm }} [options]
 * @returns {Promise<{ done: number; failed: number; skipped: number; droppedTags: number; stoppedEarly: boolean }>}
 */
export async function enrichPending(database, keys, options = {}) {
  const {
    maxReviews = Infinity,
    deadlineMs = Infinity,
    delayMs = 1000,
    backoffMs = 10_000,
    onProgress = () => {},
    llm = callLlm,
  } = options;
  const started = Date.now();
  const totals = { done: 0, failed: 0, skipped: 0, droppedTags: 0, stoppedEarly: false };
  if (!keys.groq.length && !keys.openrouter.length) return { ...totals, stoppedEarly: true };

  const seen = new Set();
  const outOfBudget = () =>
    totals.done + totals.failed >= maxReviews || Date.now() - started >= deadlineMs;

  for (;;) {
    const batch = (await fetchPendingBatch(database, seen.size)).filter((r) => !seen.has(r.review_id));
    if (!batch.length) return totals;
    for (const row of batch) {
      if (outOfBudget()) return { ...totals, stoppedEarly: true };
      seen.add(row.review_id);
      const r = row.reviews;
      if (!r.title && !r.liked_text && !r.disliked_text) {
        await database
          .from("review_enrichment")
          .update({ status: "skipped", prompt_version: PROMPT_VERSION_KEY })
          .eq("review_id", row.review_id);
        totals.skipped += 1;
        continue;
      }
      try {
        const result = await enrichReview(
          { title: r.title, likedText: r.liked_text, dislikedText: r.disliked_text },
          (prompt, opts) => llm(keys, prompt, opts),
        );
        await saveEnrichment(database, row.review_id, result);
        totals.done += 1;
        totals.droppedTags += result.droppedTags ?? 0;
        onProgress(true);
      } catch (failure) {
        if (isRateLimit(failure)) {
          // Throttling is not the review's fault: leave it pending, untouched,
          // and stop this pass so the provider can recover.
          await sleep(backoffMs);
          return { ...totals, stoppedEarly: true, rateLimited: true };
        }
        await saveFailure(database, row.review_id, failure, row.attempts ?? 0);
        totals.failed += 1;
        onProgress(false);
      }
      if (delayMs) await sleep(delayMs);
    }
  }
}
