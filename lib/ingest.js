import { createDedupeKey, normalizedText } from "./dedupe.js";
import { normalizeReview } from "./normalize.js";
import { validateReview } from "./validate.js";

const toDatabaseRow = (review, runId) => ({
  property_id: review.propertyId,
  source: review.source,
  source_review_id: review.sourceReviewId,
  dedupe_key: review.dedupeKey,
  rating_10: review.rating10,
  rating_scale: review.ratingScale,
  rating_precision: review.ratingPrecision,
  title: review.title,
  liked_text: review.likedText,
  disliked_text: review.dislikedText,
  review_date: review.reviewDate,
  stay_date: review.stayDate,
  reviewer_country: review.reviewerCountry,
  traveller_type: review.travellerType,
  room_name: review.roomName,
  nights: review.nights,
  reply_text: review.replyText,
  review_url: review.reviewUrl,
  content_hash: review.contentHash,
  first_seen_at: review.firstSeenAt,
  last_seen_at: review.lastSeenAt,
  run_id: runId,
});

/**
 * @param {object[]} items
 * @param {string} propertyId
 * @param {Date} [now]
 * @param {{ ratingScale?: 5|10 }} [options] scale of the source, default 10
 */
export function prepareReviews(items, propertyId, now = new Date(), options = {}) {
  const accepted = [];
  const rejected = [];
  for (const item of items) {
    const normalized = normalizeReview(item, propertyId, now, options);
    const result = validateReview(normalized, now);
    if (result.ok)
      accepted.push({ ...result.value, enrichable: result.enrichable });
    else
      rejected.push({
        reason: result.reason,
        payload: {
          propertyId,
          rating: item.score ?? item.rating ?? null,
          reviewDate: item.reviewDate ?? item.datetime ?? null,
        },
      });
  }
  const guarded = guardSourceIds({ accepted, rejected });
  // Actors sometimes repeat a review across pages; one batch inserts each key once.
  const keys = new Set();
  guarded.accepted = guarded.accepted.filter((r) => !keys.has(r.dedupeKey) && keys.add(r.dedupeKey));
  return guarded;
}

/**
 * If an actor reuses one id for different reviews (a hotel id, a page id),
 * trusting it would merge distinct reviews into one row. Detect that and
 * fall back to content-based keys for the whole batch.
 */
export function guardSourceIds(prepared) {
  const seen = new Map();
  let clash = false;
  for (const review of prepared.accepted) {
    if (!review.sourceReviewId) continue;
    const prior = seen.get(review.sourceReviewId);
    if (prior && prior !== review.contentHash) clash = true;
    seen.set(review.sourceReviewId, review.contentHash);
  }
  if (!clash) return prepared;
  return {
    ...prepared,
    idsDropped: true,
    accepted: prepared.accepted.map((review) => {
      const withoutId = { ...review, sourceReviewId: null };
      return { ...withoutId, dedupeKey: createDedupeKey(withoutId) };
    }),
  };
}

const KEY_CHUNK = 150;
const PAGE = 1000;

const squash = (text) => normalizedText(text).toLowerCase();

/**
 * Content keys for cross-actor matching: property, publication day, score
 * and text. Day +-1 absorbs actors that report dates in different time
 * zones. Reviews without text are not matched this way, since two different
 * rating-only reviews on one day would look identical.
 */
export function contentKeys(review) {
  if (!review.likedText && !review.dislikedText) return [];
  const day = Date.parse(review.reviewDate);
  if (!Number.isFinite(day)) return [];
  return [-1, 0, 1].map((offset) => {
    const d = new Date(day + offset * 86_400_000).toISOString().slice(0, 10);
    return `${review.propertyId}|${d}|${Number(review.rating10)}|${squash(review.likedText)}|${squash(review.dislikedText)}`;
  });
}

async function storedContentIndex(database, reviews) {
  const index = new Map();
  const byProperty = new Map();
  for (const r of reviews) {
    if (!contentKeys(r).length) continue;
    const list = byProperty.get(r.propertyId) ?? [];
    list.push(Date.parse(r.reviewDate));
    byProperty.set(r.propertyId, list);
  }
  for (const [propertyId, times] of byProperty) {
    const from = new Date(Math.min(...times) - 2 * 86_400_000).toISOString();
    const to = new Date(Math.max(...times) + 2 * 86_400_000).toISOString();
    for (let page = 0; ; page += 1) {
      const { data, error } = await database
        .from("reviews")
        .select("id, property_id, review_date, rating_10, liked_text, disliked_text")
        .eq("property_id", propertyId)
        .gte("review_date", from)
        .lte("review_date", to)
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const day = new Date(row.review_date).toISOString().slice(0, 10);
        if (!row.liked_text && !row.disliked_text) continue;
        index.set(`${row.property_id}|${day}|${Number(row.rating_10)}|${squash(row.liked_text)}|${squash(row.disliked_text)}`, row.id);
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return index;
}

export async function ingestPreparedReviews(database, runId, prepared) {
  const counts = {
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: prepared.rejected.length,
  };
  if (!prepared.accepted.length) return counts;
  const keys = prepared.accepted.map((review) => review.dedupeKey);
  // Chunked: one request with every key would exceed URL length limits on a backfill.
  const existing = [];
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const { data, error: selectError } = await database
      .from("reviews")
      .select("id, property_id, dedupe_key, content_hash")
      .in("dedupe_key", keys.slice(i, i + KEY_CHUNK));
    if (selectError) throw selectError;
    existing.push(...(data ?? []));
  }
  const existingByKey = new Map(
    existing.map((row) => [`${row.property_id}:${row.dedupe_key}`, row]),
  );
  const sameContent = await storedContentIndex(database, prepared.accepted);
  const inserts = [];
  const updates = [];
  for (const review of prepared.accepted) {
    const prior = existingByKey.get(`${review.propertyId}:${review.dedupeKey}`);
    if (!prior) {
      // Same review collected by another actor under a different id.
      const twin = contentKeys(review).map((k) => sameContent.get(k)).find(Boolean);
      if (twin) {
        const { error } = await database
          .from("reviews")
          .update({ last_seen_at: review.lastSeenAt, run_id: runId })
          .eq("id", twin);
        if (error) throw error;
        counts.unchanged += 1;
        continue;
      }
      inserts.push(review);
      continue;
    }
    if (prior.content_hash === review.contentHash) {
      const { error } = await database
        .from("reviews")
        .update({ last_seen_at: review.lastSeenAt, run_id: runId })
        .eq("id", prior.id);
      if (error) throw error;
      counts.unchanged += 1;
      continue;
    }
    updates.push({ id: prior.id, review });
  }
  if (inserts.length) {
    const { data, error } = await database
      .from("reviews")
      .insert(inserts.map((review) => toDatabaseRow(review, runId)))
      .select("id");
    if (error) throw error;
    counts.created = data?.length ?? inserts.length;
    const enrichmentRows = (data ?? []).map((row, index) => ({
      review_id: row.id,
      status: inserts[index].enrichable ? "pending" : "skipped",
    }));
    if (enrichmentRows.length) {
      const { error: enrichmentError } = await database
        .from("review_enrichment")
        .upsert(enrichmentRows);
      if (enrichmentError) throw enrichmentError;
    }
  }
  for (const { id, review } of updates) {
    const update = toDatabaseRow(review, runId);
    delete update.first_seen_at;
    const { error } = await database
      .from("reviews")
      .update({
        ...update,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
    counts.updated += 1;
  }
  return counts;
}
