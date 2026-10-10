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
  return { accepted, rejected };
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
  const { data: existing, error: selectError } = await database
    .from("reviews")
    .select("id, property_id, dedupe_key, content_hash")
    .in("dedupe_key", keys);
  if (selectError) throw selectError;
  const existingByKey = new Map(
    (existing ?? []).map((row) => [
      `${row.property_id}:${row.dedupe_key}`,
      row,
    ]),
  );
  const inserts = [];
  const updates = [];
  for (const review of prepared.accepted) {
    const prior = existingByKey.get(`${review.propertyId}:${review.dedupeKey}`);
    if (!prior) {
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
