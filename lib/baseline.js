/**
 * Keyword baseline tagger, for evaluation only.
 *
 * It answers "is the AI worth it?": if the AI does not clearly beat simple
 * keyword matching on the hand-labelled set, use the simpler method.
 * Liked text counts as praise and disliked text as complaint.
 */

export const KEYWORDS = Object.freeze({
  cleanliness: ["clean", "dirty", "filthy", "stain", "dust", "mould", "mold", "smell", "hygien", "cockroach", "bed bug", "hair"],
  check_in: ["check-in", "check in", "checkin", "check-out", "checkout", "key", "code", "self check", "virtual reception", "arrival", "access"],
  staff: ["staff", "reception", "receptionist", "manager", "friendly", "helpful", "rude", "service"],
  noise: ["noise", "noisy", "loud", "quiet", "thin wall", "hear", "sleep"],
  facilities: ["kitchen", "bathroom", "shower", "toilet", "lift", "elevator", "wifi", "wi-fi", "parking", "breakfast", "laundry", "air con", "aircon", "air-con"],
  location: ["location", "located", "close to", "walk", "station", "transport", "central", "near"],
  room_condition: ["room", "bed", "mattress", "pillow", "small", "cramped", "window", "furniture", "broken", "old"],
  value_for_money: ["price", "value", "expensive", "cheap", "overpriced", "worth", "money", "budget"],
});

/**
 * @param {{ title?: string|null; liked?: string|null; disliked?: string|null }} review
 * @returns {Array<{ topic: string; polarity: "positive"|"negative" }>}
 */
export function keywordTags(review) {
  const tags = [];
  const scan = (text, polarity) => {
    const lower = String(text ?? "").toLowerCase();
    if (!lower) return;
    for (const [topic, words] of Object.entries(KEYWORDS)) {
      if (words.some((w) => lower.includes(w))) tags.push({ topic, polarity });
    }
  };
  scan(review.liked, "positive");
  scan(review.disliked, "negative");
  return tags;
}
