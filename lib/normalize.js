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
 * Text from a value that may be a string or an object such as
 * { text, date } (some actors nest replies). Never "[object Object]".
 */
function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") return textOf(value.text ?? value.content ?? value.reply ?? value.response ?? value.body ?? value.name ?? value.value ?? "");
  return "";
}

/**
 * A free-text stay line such as "Standard Room · 2 nights · October 2026"
 * (some actors return "stay" as one string). Returns the parts it can read.
 */
export function parseStayText(value) {
  if (typeof value !== "string" || !value.trim()) return {};
  const parts = value.split(/[·•|\n]+/).map((p) => p.trim()).filter(Boolean);
  const out = {};
  for (const part of parts) {
    const nights = part.match(/^(\d+)\s*nights?$/i);
    if (nights) out.nights = Number(nights[1]);
    else if (/^(stayed in\s+)?[a-z]+\s+\d{4}$/i.test(part)) out.stay = part.replace(/^stayed in\s+/i, "");
    else if (/room|bed|dorm|pod|suite|studio|apartment/i.test(part)) out.room = part;
    else if (/solo|couple|family|group|friends|business/i.test(part)) out.traveller = part;
  }
  return out;
}

/** First defined, non-empty value among the named fields. */
function pick(item, keys) {
  for (const key of keys) {
    const value = key.includes(".")
      ? key.split(".").reduce((o, k) => (o && typeof o === "object" && !Array.isArray(o) ? o[k] : undefined), item)
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
const STAY_KEYS = ["checkIn", "checkInDate", "check_in", "stayDate", "dateOfExperience", "stayMonth", "stayedIn", "stay.date", "stay.check_in", "stay.checkin", "stay.checkin_date", "stay.check_in_date", "stay.stay_date", "stay.month"];
// Nested keys cover actors that group details (omkar-cloud: "guest", "stay").
// From "guest" only the country is ever read; the name is never touched.
const COUNTRY_KEYS = ["country", "userLocation", "reviewerCountry", "guestCountry", "nationality", "reviewer.country", "user.country", "guest.country", "guest.country_name", "guest.countryName", "guest.nationality", "guest.location"];
const TRAVELLER_KEYS = ["travelType", "travelerType", "travellerType", "tripType", "guestType", "travellerTypeName", "guest.type", "guest.traveler_type", "guest.traveller_type", "guest.group", "stay.traveler_type", "stay.traveller_type", "stay.travel_type", "stay.group_type", "stay.trip_type"];
const ROOM_KEYS = ["roomType", "room_name", "roomName", "room", "roomInfo", "stay.room", "stay.room_name", "stay.room_type", "stay.roomType", "stay.roomName"];
const NIGHTS_KEYS = ["numNights", "numberOfNights", "nights", "stayLength", "nightsStayed", "lengthOfStay", "stay.nights", "stay.num_nights", "stay.number_of_nights", "stay.length", "stay.duration"];
const REPLY_KEYS = ["hotelResponse", "reply", "propertyResponse", "ownerResponse", "hotelReply", "propertyReply", "managementResponse", "owner_reply", "ownerReply", "response"];
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
  const urlValue = nullableText(textOf(pick(item, URL_KEYS)));
  const stayText = parseStayText(item?.stay);
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
    title: nullableText(textOf(pick(item, TITLE_KEYS))),
    likedText: nullableText(textOf(pick(item, LIKED_KEYS))),
    dislikedText: nullableText(textOf(pick(item, DISLIKED_KEYS))),
    reviewDate: isoDate(pick(item, DATE_KEYS)),
    stayDate: stayValue(pick(item, STAY_KEYS) ?? stayText.stay),
    reviewerCountry: nullableText(textOf(pick(item, COUNTRY_KEYS))),
    travellerType: nullableText(textOf(pick(item, TRAVELLER_KEYS)) || stayText.traveller || ""),
    roomName: nullableText(textOf(pick(item, ROOM_KEYS)) || stayText.room || ""),
    nights: nightsValue(pick(item, NIGHTS_KEYS) ?? stayText.nights),
    replyText: nullableText(textOf(pick(item, REPLY_KEYS))),
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
