/**
 * KPI aggregation queries.
 *
 * All queries are read-only and work against the Supabase service-role client.
 * Dates are interpreted in the configured timezone (Australia/Sydney).
 *
 * Exported functions:
 *   ratingKpis(db, propertyId?, windowDays?)  — average + breakdown by rating band
 *   topicKpis(db, propertyId?, windowDays?)   — topic frequency + polarity split
 *   trendKpis(db, propertyId?, periods?)      — weekly average rating trend
 *   sentimentKpis(db, propertyId?, windowDays?) — average sentiment score
 */

import { thresholds, timezone } from "../dashboard.config.js";

const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_TREND_PERIODS = 12; // weeks

// ── Rating KPIs ───────────────────────────────────────────────────────────

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {string|null} propertyId   null = all properties
 * @param {number} windowDays
 */
export async function ratingKpis(db, propertyId = null, windowDays = DEFAULT_WINDOW_DAYS) {
  const cutoff = isoDateDaysAgo(windowDays);
  let query = db
    .from("reviews")
    .select("property_id, rating_10")
    .gte("review_date", cutoff);
  if (propertyId) query = query.eq("property_id", propertyId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return emptyRatingKpis();

  const total = rows.length;
  const sum = rows.reduce((acc, r) => acc + Number(r.rating_10), 0);
  const avg = sum / total;

  const negative = rows.filter((r) => Number(r.rating_10) < thresholds.negative).length;
  const positive = rows.filter((r) => Number(r.rating_10) >= thresholds.positive).length;

  return {
    averageRating: round2(avg),
    totalReviews: total,
    positiveCount: positive,
    negativeCount: negative,
    neutralCount: total - positive - negative,
    positiveRate: round2(positive / total),
    negativeRate: round2(negative / total),
    windowDays,
  };
}

function emptyRatingKpis() {
  return {
    averageRating: null,
    totalReviews: 0,
    positiveCount: 0,
    negativeCount: 0,
    neutralCount: 0,
    positiveRate: null,
    negativeRate: null,
    windowDays: DEFAULT_WINDOW_DAYS,
  };
}

// ── Topic KPIs ────────────────────────────────────────────────────────────

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {string|null} propertyId
 * @param {number} windowDays
 * @returns {Promise<Array<{ topic: string; positiveCount: number; negativeCount: number; total: number; negativeRate: number }>>}
 */
export async function topicKpis(db, propertyId = null, windowDays = DEFAULT_WINDOW_DAYS) {
  const cutoff = isoDateDaysAgo(windowDays);

  // Join review_topics → reviews to apply date and property filter.
  let query = db
    .from("review_topics")
    .select(
      `topic, polarity,
       reviews!inner ( property_id, review_date )`,
    )
    .gte("reviews.review_date", cutoff);
  if (propertyId) query = query.eq("reviews.property_id", propertyId);

  const { data, error } = await query;
  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    const key = row.topic;
    if (!map[key]) map[key] = { topic: key, positiveCount: 0, negativeCount: 0 };
    if (row.polarity === "positive") map[key].positiveCount += 1;
    else map[key].negativeCount += 1;
  }

  return Object.values(map)
    .map((t) => ({
      ...t,
      total: t.positiveCount + t.negativeCount,
      negativeRate: round2(
        t.negativeCount / (t.positiveCount + t.negativeCount),
      ),
    }))
    .sort((a, b) => b.total - a.total);
}

// ── Trend KPIs ────────────────────────────────────────────────────────────

/**
 * Weekly average rating trend (most-recent N weeks).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {string|null} propertyId
 * @param {number} periods  number of weeks
 * @returns {Promise<Array<{ weekStart: string; averageRating: number; count: number }>>}
 */
export async function trendKpis(db, propertyId = null, periods = DEFAULT_TREND_PERIODS) {
  const windowDays = periods * 7;
  const cutoff = isoDateDaysAgo(windowDays);

  let query = db
    .from("reviews")
    .select("review_date, rating_10, property_id")
    .gte("review_date", cutoff)
    .order("review_date", { ascending: true });
  if (propertyId) query = query.eq("property_id", propertyId);

  const { data, error } = await query;
  if (error) throw error;

  // Bucket by ISO week start (Monday) in Sydney timezone.
  const buckets = {};
  for (const row of data ?? []) {
    const weekStart = weekStartISO(row.review_date, timezone);
    if (!buckets[weekStart]) buckets[weekStart] = { sum: 0, count: 0 };
    buckets[weekStart].sum += Number(row.rating_10);
    buckets[weekStart].count += 1;
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, { sum, count }]) => ({
      weekStart,
      averageRating: round2(sum / count),
      count,
    }));
}

// ── Sentiment KPIs ────────────────────────────────────────────────────────

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {string|null} propertyId
 * @param {number} windowDays
 */
export async function sentimentKpis(db, propertyId = null, windowDays = DEFAULT_WINDOW_DAYS) {
  const cutoff = isoDateDaysAgo(windowDays);

  let query = db
    .from("review_enrichment")
    .select(
      `sentiment_score,
       reviews!inner ( property_id, review_date )`,
    )
    .eq("status", "done")
    .not("sentiment_score", "is", null)
    .gte("reviews.review_date", cutoff);
  if (propertyId) query = query.eq("reviews.property_id", propertyId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return { averageSentiment: null, enrichedCount: 0 };

  const avg =
    rows.reduce((acc, r) => acc + Number(r.sentiment_score), 0) / rows.length;

  return {
    averageSentiment: round2(avg),
    enrichedCount: rows.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function weekStartISO(dateStr, _tz) {
  const d = new Date(dateStr);
  const dow = d.getUTCDay(); // 0=Sun
  const offset = (dow + 6) % 7; // days since Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - offset);
  return monday.toISOString().slice(0, 10);
}
