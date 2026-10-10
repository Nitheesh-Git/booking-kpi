/**
 * API service layer for dashboard and reporting queries.
 */

import { properties } from "../dashboard.config.js";
import { ratingKpis, topicKpis, trendKpis, sentimentKpis } from "./kpi.js";

/**
 * Fetch all properties with current stats (total reviews, average rating).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 */
export async function getPropertiesSummary(db) {
  const { data: reviews, error } = await db
    .from("reviews")
    .select("property_id, rating_10, review_date");
  if (error) throw error;

  const statsByProperty = new Map();
  for (const p of properties) {
    statsByProperty.set(p.id, {
      ...p,
      totalReviews: 0,
      ratingSum: 0,
      oldestReview: null,
      latestReview: null,
    });
  }

  for (const r of reviews ?? []) {
    const stat = statsByProperty.get(r.property_id);
    if (!stat) continue;
    stat.totalReviews += 1;
    stat.ratingSum += Number(r.rating_10);
    if (!stat.oldestReview || r.review_date < stat.oldestReview) {
      stat.oldestReview = r.review_date;
    }
    if (!stat.latestReview || r.review_date > stat.latestReview) {
      stat.latestReview = r.review_date;
    }
  }

  return Array.from(statsByProperty.values()).map((p) => ({
    id: p.id,
    name: p.name,
    bookingUrl: p.bookingUrl,
    totalReviews: p.totalReviews,
    averageRating:
      p.totalReviews > 0
        ? Math.round((p.ratingSum / p.totalReviews) * 10) / 10
        : null,
    oldestReview: p.oldestReview,
    latestReview: p.latestReview,
  }));
}

/**
 * Fetch aggregated KPIs for a property and window.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {{ propertyId?: string|null; days?: number }} options
 */
export async function getDashboardKpis(db, { propertyId = null, days = 90 } = {}) {
  const [rating, sentiment, topics, trend] = await Promise.all([
    ratingKpis(db, propertyId, days),
    sentimentKpis(db, propertyId, days),
    topicKpis(db, propertyId, days),
    trendKpis(db, propertyId, 12),
  ]);

  return {
    propertyId,
    windowDays: days,
    rating,
    sentiment,
    topics,
    trend,
  };
}

/**
 * Fetch paginated reviews with enrichment and topic details.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {{
 *   propertyId?: string|null;
 *   topic?: string|null;
 *   limit?: number;
 *   offset?: number;
 * }} options
 */
export async function getReviewsList(
  db,
  { propertyId = null, topic = null, limit = 20, offset = 0 } = {},
) {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);

  let query = db
    .from("reviews")
    .select(
      `id, property_id, rating_10, rating_scale, rating_precision,
       title, liked_text, disliked_text, review_date, stay_date,
       reviewer_country, traveller_type, room_name, nights, reply_text, review_url,
       review_enrichment ( sentiment_score, status, provider ),
       review_topics ( topic, polarity, severity, evidence )`,
      { count: "exact" },
    )
    .order("review_date", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (propertyId) {
    query = query.eq("property_id", propertyId);
  }

  const { data, count, error } = await query;
  if (error) throw error;

  let rows = data ?? [];

  // Filter by topic if requested
  if (topic) {
    rows = rows.filter((r) =>
      r.review_topics?.some((t) => t.topic === topic),
    );
  }

  return {
    total: count ?? rows.length,
    offset: safeOffset,
    limit: safeLimit,
    reviews: rows.map((r) => {
      const enrichment = Array.isArray(r.review_enrichment)
        ? r.review_enrichment[0]
        : r.review_enrichment;
      return {
        id: r.id,
        propertyId: r.property_id,
        rating10: Number(r.rating_10),
        ratingScale: r.rating_scale,
        ratingPrecision: r.rating_precision,
        title: r.title,
        likedText: r.liked_text,
        dislikedText: r.disliked_text,
        reviewDate: r.review_date,
        stayDate: r.stay_date,
        reviewerCountry: r.reviewer_country,
        travellerType: r.traveller_type,
        roomName: r.room_name,
        nights: r.nights,
        replyText: r.reply_text,
        reviewUrl: r.review_url,
        sentimentScore: enrichment?.sentiment_score != null
          ? Number(enrichment.sentiment_score)
          : null,
        enrichmentStatus: enrichment?.status ?? "pending",
        topics: r.review_topics ?? [],
      };
    }),
  };
}

/**
 * Fetch recent collection audit runs.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {number} limit
 */
export async function getScrapeRuns(db, limit = 10) {
  const { data, error } = await db
    .from("scrape_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
