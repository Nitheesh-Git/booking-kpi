/**
 * Data sources for the dashboard API.
 *
 * Both return canonical reviews (see `lib/analytics.js`), so the analytics
 * code does not know where data came from.
 *
 * - Supabase: the live database. Reads are paged because PostgREST caps a
 *   single response at 1,000 rows by default; without paging, totals would
 *   silently stop at 1,000 once the dataset grows.
 * - File: `data/sample/reviews.json`, written by `npm run export-sample`.
 *   Used when Supabase is not configured, so the dashboard runs from a fresh
 *   clone with the committed real sample.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { properties, staleAfterDays } from "../dashboard.config.js";
import { createDatabaseClient } from "./db.js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/** Database row to canonical review. Reviewer names never exist here. */
export function fromDatabaseRow(row) {
  const enrichment = Array.isArray(row.review_enrichment)
    ? row.review_enrichment[0]
    : row.review_enrichment;
  return {
    id: row.id,
    propertyId: row.property_id,
    rating: Number(row.rating_10),
    ratingPrecision: row.rating_precision ?? "exact",
    reviewDate: new Date(row.review_date).toISOString(),
    title: row.title ?? null,
    liked: row.liked_text ?? null,
    disliked: row.disliked_text ?? null,
    stayDate: row.stay_date ?? null,
    country: row.reviewer_country ?? null,
    travellerType: row.traveller_type ?? null,
    roomName: row.room_name ?? null,
    nights: row.nights ?? null,
    reply: row.reply_text ?? null,
    reviewUrl: row.review_url ?? null,
    enrichmentStatus: enrichment?.status ?? "pending",
    sentiment:
      enrichment?.sentiment_score != null ? Number(enrichment.sentiment_score) : null,
    topics: (row.review_topics ?? []).map((t) => ({
      topic: t.topic,
      polarity: t.polarity,
      severity: Number(t.severity),
      evidence: t.evidence,
    })),
  };
}

const REVIEW_COLUMNS = `id, property_id, rating_10, rating_precision, review_date,
  title, liked_text, disliked_text, stay_date, reviewer_country, traveller_type,
  room_name, nights, reply_text, review_url,
  review_enrichment ( status, sentiment_score ),
  review_topics ( topic, polarity, severity, evidence )`;

async function pagedSelect(buildQuery) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Query exceeded ${MAX_PAGES * PAGE_SIZE} rows`);
}

/** @param {import("@supabase/supabase-js").SupabaseClient} db */
export function createSupabaseSource(db) {
  return {
    kind: "supabase",
    /** @param {{ fromUtc: string; toUtc: string }} range half-open [from, to) */
    async loadReviews({ fromUtc, toUtc }) {
      const rows = await pagedSelect(() =>
        db
          .from("reviews")
          .select(REVIEW_COLUMNS)
          .gte("review_date", fromUtc)
          .lt("review_date", toUtc)
          .order("review_date", { ascending: false })
          .order("id", { ascending: true }),
      );
      return rows.map(fromDatabaseRow);
    },
    async loadHealth() {
      const [reviewRows, enrichmentRows, runsResult] = await Promise.all([
        pagedSelect(() =>
          db.from("reviews").select("property_id, review_date, last_seen_at, rating_10").order("id"),
        ),
        pagedSelect(() =>
          db.from("review_enrichment").select("status, reviews!inner ( property_id )").order("review_id"),
        ),
        db
          .from("scrape_runs")
          .select("id, trigger, status, started_at, finished_at, items_fetched, created, updated, unchanged, rejected, error, actor, property_id")
          .order("started_at", { ascending: false })
          .limit(20),
      ]);
      if (runsResult.error) throw runsResult.error;
      return summarizeHealth({
        reviews: reviewRows.map((r) => ({
          propertyId: r.property_id,
          reviewDate: r.review_date,
          rating: Number(r.rating_10),
          lastSeenAt: r.last_seen_at,
        })),
        enrichment: enrichmentRows.map((e) => ({
          propertyId: e.reviews?.property_id,
          status: e.status,
        })),
        runs: runsResult.data ?? [],
        source: "supabase",
      });
    },
  };
}

/** @param {string} path */
export function createFileSource(path) {
  let cache = null;
  const load = () => {
    if (!cache) {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      cache = {
        meta: parsed.meta ?? {},
        reviews: Array.isArray(parsed) ? parsed : (parsed.reviews ?? []),
      };
    }
    return cache;
  };
  return {
    kind: "sample",
    async loadReviews({ fromUtc, toUtc }) {
      return load().reviews.filter((r) => r.reviewDate >= fromUtc && r.reviewDate < toUtc);
    },
    async loadHealth() {
      const { reviews, meta } = load();
      return summarizeHealth({
        reviews: reviews.map((r) => ({ propertyId: r.propertyId, reviewDate: r.reviewDate, rating: r.rating, lastSeenAt: null })),
        enrichment: reviews.map((r) => ({ propertyId: r.propertyId, status: r.enrichmentStatus })),
        runs: [],
        source: "sample",
        exportedAt: meta.exportedAt ?? null,
        // A saved sample is judged as of its export, or it would look broken forever.
        now: meta.exportedAt ? new Date(meta.exportedAt) : new Date(),
      });
    },
  };
}

/** Thresholds for the per-property data checks. */
export const DATA_CHECKS = Object.freeze({ staleDays: staleAfterDays, minReviewsForSpread: 50, minDistinctScores: 4 });

/**
 * Plain-language problems with one property's stored reviews.
 * These catch collection faults that are invisible in the numbers:
 * found 2026-10-10, three properties had 100 reviews spread over years
 * with only three adjacent mid-range scores, and nothing from recent weeks.
 *
 * @param {Array<{ reviewDate: string; rating: number }>} reviews
 * @param {Date} now  pass the export time for a saved sample, not today
 */
export function propertyDataIssues(reviews, now = new Date()) {
  const issues = [];
  if (!reviews.length) return ["No reviews stored."];
  const newest = reviews.reduce((m, r) => (r.reviewDate > m ? r.reviewDate : m), "");
  const age = Math.floor((now.getTime() - new Date(newest).getTime()) / 86_400_000);
  if (age > DATA_CHECKS.staleDays)
    issues.push(`No reviews newer than ${age} days. Either the property had none, or collection is not fetching new ones. Recent weeks may be incomplete.`);
  const scores = [...new Set(reviews.map((r) => r.rating).filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);
  // A narrow band that excludes 10 is the suspicious case; an excellent
  // property scoring only 8 to 10 is plausible and not flagged.
  if (
    reviews.length >= DATA_CHECKS.minReviewsForSpread &&
    scores.length > 0 &&
    scores.length < DATA_CHECKS.minDistinctScores &&
    scores.at(-1) < 10
  )
    issues.push(`All ${reviews.length} reviews score between ${scores[0]} and ${scores.at(-1)}. Real reviews vary more, so the sample is probably filtered and averages are unreliable.`);
  return issues;
}

/** Per-property freshness and quality summary for the data health tab. */
export function summarizeHealth({ reviews, enrichment, runs, source, exportedAt = null, now = new Date() }) {
  const perProperty = properties.map((p) => {
    const mine = reviews.filter((r) => r.propertyId === p.id);
    const newest = mine.reduce((m, r) => (!m || r.reviewDate > m ? r.reviewDate : m), null);
    const lastSeen = mine.reduce((m, r) => (r.lastSeenAt && (!m || r.lastSeenAt > m) ? r.lastSeenAt : m), null);
    const statuses = { pending: 0, done: 0, failed: 0, skipped: 0 };
    for (const e of enrichment) if (e.propertyId === p.id && e.status in statuses) statuses[e.status] += 1;
    return {
      id: p.id,
      name: p.name,
      reviews: mine.length,
      newestReview: newest,
      lastCollected: lastSeen,
      enrichment: statuses,
      issues: propertyDataIssues(mine, now),
    };
  });
  const lastRun = runs[0] ?? null;
  const lastGood = runs.find((r) => r.status === "ingested" || r.status === "enriched") ?? null;
  const recentProblems = runs.filter((r) => r.status === "failed" || r.status === "degraded").slice(0, 5);
  // Each cron ingests yesterday's runs and starts new ones, so the newest row
  // is usually a fresh "running" run. Look at every run that finished recently.
  const recentCutoff = now.getTime() - 2 * 86_400_000;
  const recentFailures = runs.filter(
    (r) =>
      (r.status === "failed" || r.status === "degraded") &&
      new Date(r.finished_at ?? r.started_at).getTime() >= recentCutoff,
  );
  const status = recentFailures.length || perProperty.some((p) => p.issues.length) ? "attention" : "ok";
  return {
    source,
    status,
    exportedAt,
    lastRun,
    lastSuccessfulRun: lastGood,
    recentProblems,
    recentFailures,
    runs: runs.slice(0, 10),
    properties: perProperty,
  };
}

/**
 * Pick the data source from the environment.
 * Supabase when credentials exist, otherwise the committed sample file.
 */
/**
 * Resolved from this file, not the working directory: on Vercel the function
 * runs from a different directory, and this form lets the bundler see and
 * package the file.
 */
export const DEFAULT_SAMPLE_PATH = fileURLToPath(new URL("../data/sample/reviews.json", import.meta.url));

export function createSource(environment, samplePath = DEFAULT_SAMPLE_PATH) {
  if (environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseSource(createDatabaseClient(environment));
  }
  const path = environment.SAMPLE_DATA_PATH || samplePath;
  if (existsSync(path)) return createFileSource(path);
  return null;
}
