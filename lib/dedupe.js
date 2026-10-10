import { createHash } from "node:crypto";

export function normalizedText(value) {
  return (value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
}

export function createDedupeKey(review) {
  if (review.sourceReviewId) return review.sourceReviewId;
  return createHash("sha256")
    .update(
      [
        review.propertyId,
        review.reviewDate,
        normalizedText(review.likedText),
        normalizedText(review.dislikedText),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

export function createContentHash(review) {
  const fields = [
    "title",
    "likedText",
    "dislikedText",
    "replyText",
    "rating10",
    "reviewDate",
  ];
  return createHash("sha256")
    .update(
      fields
        .map((field) => normalizedText(String(review[field] ?? "")))
        .join("|"),
    )
    .digest("hex");
}
