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

/** First defined, non-empty value among the named fields. */
function pick(item, keys) {
  for (const key of keys) {
    const value = key.includes(".")
      ? key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), item)
      : item?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

// Field names seen across Booking review actors. Reviewer names are never read.
const RATING_KEYS = ["score", "rating", "rating_10", "reviewScore", "review_score", "ratingValue", "guestScore", "scoreValue"];
const LIKED_KEYS = ["positive", "likedText", "liked", "positiveText", "positive_text", "pros", "textPositive", "reviewPositive", "text.positive", "liked_text"];
const DISLIKED_KEYS = ["negative", "dislikedText", "disliked", "negativeText", "negative_text", "cons", "textNegative", "reviewNegative", "text.negative", "disliked_text"];
const TITLE_KEYS = ["title", "reviewTitle", "review_title", "headline"];
const DATE_KEYS = ["reviewDate", "datetime", "review_date", "reviewedDate", "reviewedAt", "publishedDate", "publishedAt", "date", "createdAt"];
const STAY_KEYS = ["checkIn", "checkInDate", "check_in", "stayDate", "dateOfExperience", "stayMonth", "stayedIn"];
const COUNTRY_KEYS = ["country", "userLocation", "reviewerCountry", "guestCountry", "nationality", "reviewer.country", "user.country"];
const TRAVELLER_KEYS = ["travelType", "travelerType", "travellerType", "tripType", "guestType", "travellerTypeName"];
const ROOM_KEYS = ["roomType", "room_name", "roomName", "room", "roomInfo"];
const NIGHTS_KEYS = ["numNights", "numberOfNights", "nights", "stayLength", "nightsStayed", "lengthOfStay"];
const REPLY_KEYS = ["hotelResponse", "reply", "propertyResponse", "ownerResponse", "hotelReply", "propertyReply", "managementResponse", "response"];
const URL_KEYS = ["reviewUrl", "review_url", "reviewLink", "link"];
const ID_KEYS = ["reviewId", "review_id", "id"];

/**
 * A score as a number: accepts 8, "8.0", "8,0" or "Scored 8.0". Null when
 * absent. The scale is never inferred here (see normalizeReview).
 */
export function extractRating(item) {
  const raw = pick(item, RATING_KEYS);
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const match = String(raw).match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
}

/** Any parseable date becomes an ISO instant; anything else is kept for validation to reject. */
function isoDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const text = String(value).replace(/^(reviewed|posted)[:\s]*/i, "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(text) ? new Date(text).toISOString() : text;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function nightsValue(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).match(/\d+/)?.[0]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function stayValue(value) {
  if (value == null || value === "") return null;
  const iso = isoDate(value);
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
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
  const rawRating = extractRating(item) ?? Number.NaN;
  const rating10 = ratingScale === 5 ? rawRating * 2 : rawRating;
  const urlValue = nullableText(pick(item, URL_KEYS) ?? "");
  // Only a link to one review counts as a review link; a hotel link is dropped.
  const reviewUrl = urlValue && /review/i.test(urlValue) ? urlValue : null;
  const normalized = {
    propertyId,
    source: "booking",
    // Booking's own review id (from the link) wins, so the same review
    // collected by different actors gets the same key.
    sourceReviewId: nullableText(
      String(selectedReviewId(reviewUrl) ?? pick(item, ID_KEYS) ?? ""),
    ),
    rating10,
    ratingScale,
    ratingPrecision: ratingScale === 5 ? "rounded" : "exact",
    title: nullableText(pick(item, TITLE_KEYS) ?? ""),
    likedText: nullableText(pick(item, LIKED_KEYS) ?? ""),
    dislikedText: nullableText(pick(item, DISLIKED_KEYS) ?? ""),
    reviewDate: isoDate(pick(item, DATE_KEYS)),
    stayDate: stayValue(pick(item, STAY_KEYS)),
    reviewerCountry: nullableText(pick(item, COUNTRY_KEYS) ?? ""),
    travellerType: nullableText(pick(item, TRAVELLER_KEYS) ?? ""),
    roomName: nullableText(pick(item, ROOM_KEYS) ?? ""),
    nights: nightsValue(pick(item, NIGHTS_KEYS)),
    replyText: nullableText(pick(item, REPLY_KEYS) ?? ""),
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
