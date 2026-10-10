import {
  createContentHash,
  createDedupeKey,
  normalizedText,
} from "./dedupe.js";

function nullableText(value) {
  const normalized = normalizedText(value);
  return normalized || null;
}

function selectedReviewId(value) {
  if (!value) return null;
  try {
    return new URL(value).searchParams.get("selected_review_id");
  } catch {
    return null;
  }
}

/**
 * Converts source rows into a privacy-safe allowlisted shape.
 *
 * The rating scale must be told, never guessed from the value: a genuine
 * Booking.com score of 4 out of 10 looks exactly like 4 out of 5. Guessing
 * once doubled the worst reviews into 8s and 10s (fixed 2026-10-10).
 *
 * @param {object} item source row
 * @param {string} propertyId
 * @param {Date} [now]
 * @param {{ ratingScale?: 5|10 }} [options] scale of the source, default 10
 */
export function normalizeReview(item, propertyId, now = new Date(), { ratingScale = 10 } = {}) {
  const rawRating = Number(item.score ?? item.rating ?? item.rating_10);
  const rating10 = ratingScale === 5 ? rawRating * 2 : rawRating;
  const reviewUrl = nullableText(item.reviewUrl ?? item.review_url ?? "");
  const normalized = {
    propertyId,
    source: "booking",
    sourceReviewId: nullableText(
      item.id ?? item.reviewId ?? selectedReviewId(reviewUrl) ?? "",
    ),
    rating10,
    ratingScale,
    ratingPrecision: ratingScale === 5 ? "rounded" : "exact",
    title: nullableText(item.title ?? ""),
    likedText: nullableText(
      item.positive ?? item.likedText ?? item.liked ?? item.text?.positive ?? "",
    ),
    dislikedText: nullableText(
      item.negative ?? item.dislikedText ?? item.disliked ?? item.text?.negative ?? "",
    ),
    reviewDate: String(
      item.reviewDate ?? item.datetime ?? item.review_date ?? "",
    ),
    stayDate: nullableText(
      item.checkIn ?? item.dateOfExperience ?? item.stayDate ?? "",
    ),
    reviewerCountry: nullableText(
      item.country ?? item.userLocation ?? item.reviewerCountry ?? "",
    ),
    travellerType: nullableText(
      item.travelType ?? item.travelerType ?? item.travellerType ?? "",
    ),
    roomName: nullableText(
      item.roomType ?? item.room_name ?? item.roomName ?? "",
    ),
    nights: item.numNights ?? item.numberOfNights ?? item.nights ?? null,
    replyText: nullableText(
      item.hotelResponse ?? item.reply ?? item.propertyResponse ?? "",
    ),
    reviewUrl,
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
  };
  return {
    ...normalized,
    dedupeKey: createDedupeKey(normalized),
    contentHash: createContentHash(normalized),
  };
}
