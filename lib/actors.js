/**
 * Apify actor profiles and input building.
 *
 * Actors are tried in the order given in APIFY_ACTOR_ID (comma-separated).
 * Chosen 2026-10-10 from Apify listings (prices are listing figures):
 *
 * - apt_marble/booking-reviews-scraper: primary. From about USD 0.30 per
 *   1,000 reviews. Listed inputs: sortBy (newest first), onlyReviewsSince
 *   (stops at the date when sorting newest first), maxReviewsPerHotel.
 * - omkar-cloud/booking-reviews-scraper: fallback. USD 1 per 1,000, no
 *   start fee. Listed inputs: newest sort, cutoffDate, maxReviewsPerHotel.
 * - scrapeunblocker/booking-reviews-scraper: last resort. USD 0.40 per
 *   1,000, but only the newest 15 reviews per language: fine for daily
 *   top-ups, useless for backfill.
 *
 * Input names were read from listings, not verified against a live run,
 * so the real input schema is fetched from Apify before each run and the
 * fields are matched by name and allowed values (buildActorInput). The
 * profile inputs below are used only when the schema cannot be read.
 * APIFY_INPUT_OVERRIDES can still force any field.
 */

/** @typedef {{ url: string; since: string|null; max: number }} RunIntent */

export const ACTOR_PROFILES = Object.freeze({
  "apt_marble/booking-reviews-scraper": {
    label: "apt_marble",
    ratingScale: 10,
    input: ({ url, since, max }) => ({
      startUrls: [{ url }],
      sortBy: "newest_first",
      maxReviewsPerHotel: max,
      ...(since ? { onlyReviewsSince: since } : {}),
    }),
  },
  "omkar-cloud/booking-reviews-scraper": {
    label: "omkar-cloud",
    ratingScale: 10,
    input: ({ url, since, max }) => ({
      startUrls: [url],
      sortBy: "newest",
      maxReviewsPerHotel: max,
      ...(since ? { cutoffDate: since } : {}),
    }),
  },
  "scrapeunblocker/booking-reviews-scraper": {
    label: "scrapeunblocker",
    ratingScale: 10,
    input: ({ url, since, max }) => ({
      startUrls: [{ url }],
      maxReviews: max,
      sortBy: "newest",
      ...(since ? { dateFrom: since } : {}),
    }),
  },
});

/** Unknown actors get a generic profile; scores are assumed out of 10. */
export function actorProfile(actorId) {
  return (
    ACTOR_PROFILES[normalizeActorId(actorId)] ?? {
      label: actorId,
      ratingScale: 10,
      input: ({ url, since, max }) => ({
        startUrls: [{ url }],
        maxReviews: max,
        ...(since ? { onlyReviewsSince: since } : {}),
      }),
    }
  );
}

/** "owner~name" and "owner/name" are the same actor. */
export function normalizeActorId(actorId) {
  return String(actorId ?? "").trim().replace("~", "/");
}

/** Apify's API path form: owner~name. */
export function apiActorId(actorId) {
  return normalizeActorId(actorId).replace("/", "~");
}

const URL_KEYS = ["startUrls", "hotelUrls", "urls", "startUrl", "hotelUrl", "url", "propertyUrls"];
const MAX_KEYS = ["maxReviewsPerHotel", "maxReviewsPerProperty", "maxReviews", "maxItems", "maxResults", "limit", "reviewsLimit"];
const SORT_KEYS = ["sortBy", "sort", "sortOrder", "reviewsSort", "sortReviewsBy", "order"];
const SINCE_KEYS = ["onlyReviewsSince", "cutoffDate", "reviewsSince", "startDate", "dateFrom", "fromDate", "since", "minDate", "reviewsFrom"];
const NEWEST = /newest|recent|latest|f_recent_desc|date[_ -]?desc|desc[_ -]?date/i;

const firstKey = (props, keys) => keys.find((k) => Object.hasOwn(props, k));

function enumValues(prop) {
  return prop?.enum ?? prop?.items?.enum ?? null;
}

function urlValue(prop, url) {
  if (prop.type === "string") return url;
  const objects =
    prop.editor === "requestListSources" ||
    prop.items?.type === "object" ||
    (Array.isArray(prop.prefill) && typeof prop.prefill[0] === "object") ||
    (Array.isArray(prop.default) && typeof prop.default[0] === "object");
  return objects ? [{ url }] : [url];
}

/**
 * Build an actor's input from its published input schema.
 * Returns the input, which intent fields were mapped, and warnings.
 *
 * @param {{ properties?: Record<string, any> }|null} schema
 * @param {RunIntent} intent
 * @param {{ input: (i: RunIntent) => object }} profile
 */
export function buildActorInput(schema, intent, profile) {
  const props = schema?.properties;
  if (!props || typeof props !== "object") {
    return { input: profile.input(intent), mapped: "profile", warnings: ["Input schema unavailable; used built-in profile"] };
  }
  const input = {};
  const warnings = [];

  const urlKey = firstKey(props, URL_KEYS);
  if (urlKey) input[urlKey] = urlValue(props[urlKey], intent.url);
  else warnings.push("No hotel URL field found in the input schema");

  const maxKey = firstKey(props, MAX_KEYS);
  if (maxKey) {
    const cap = Number(props[maxKey].maximum);
    input[maxKey] = Number.isFinite(cap) ? Math.min(intent.max, cap) : intent.max;
  } else warnings.push("No review cap field found; the actor's default cap applies");

  const sortKey = firstKey(props, SORT_KEYS);
  const newest = sortKey && enumValues(props[sortKey])?.find((v) => NEWEST.test(String(v)));
  if (newest) input[sortKey] = newest;
  else warnings.push("No newest-first sort option found; recency is checked after the run");

  const sinceKey = firstKey(props, SINCE_KEYS);
  if (sinceKey && intent.since) input[sinceKey] = intent.since;
  else if (intent.since) warnings.push("No date cutoff field found; the full cap is fetched");

  return { input, mapped: { urlKey, maxKey, sortKey: newest ? sortKey : null, sinceKey: intent.since ? sinceKey : null }, warnings };
}

/**
 * APIFY_INPUT_OVERRIDES: a flat JSON object applied to every actor, or an
 * object keyed by actor id ({"owner/name": {...}}) for per-actor fields.
 */
export function overridesFor(actorId, environment = {}) {
  const raw = environment.APIFY_INPUT_OVERRIDES;
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("APIFY_INPUT_OVERRIDES is not valid JSON; ignoring it");
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const keyed = Object.keys(parsed).some((k) => k.includes("/") || k.includes("~"));
  if (!keyed) return parsed;
  const id = normalizeActorId(actorId);
  const match = Object.entries(parsed).find(([k]) => normalizeActorId(k) === id);
  return match?.[1] ?? {};
}
