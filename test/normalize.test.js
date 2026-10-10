import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeReview } from "../lib/normalize.js";
import { validateReview } from "../lib/validate.js";
import { createDedupeKey } from "../lib/dedupe.js";
import { prepareReviews } from "../lib/ingest.js";

const fixture = JSON.parse(
  readFileSync("data/fixtures/apify-primary-olympic-paddington.json", "utf8"),
);
const now = new Date("2026-10-10T00:00:00.000Z");

describe("normalizeReview", () => {
  it("uses an allowlist and derives Booking selected review ids", () => {
    const review = normalizeReview(
      { ...fixture[0], reviewer: "Never retain me" },
      "olympic-paddington",
      now,
    );
    expect(review.sourceReviewId).toBe("6a9f7483d90ddf24");
    expect(review).not.toHaveProperty("reviewer");
    expect(validateReview(review, now).ok).toBe(true);
  });

  it("converts five point scores to rounded ten point scores", () => {
    const review = normalizeReview(
      { rating: 4, datetime: "2026-10-01T00:00:00.000Z" },
      "potts-point",
      now,
    );
    expect(review.rating10).toBe(8);
    expect(review.ratingPrecision).toBe("rounded");
  });

  it("creates stable fallback keys and rejects future dates", () => {
    const base = {
      propertyId: "potts-point",
      reviewDate: "2026-10-01T00:00:00.000Z",
      likedText: " Tidy room ",
      dislikedText: null,
    };
    expect(createDedupeKey(base)).toBe(
      createDedupeKey({ ...base, likedText: "Tidy   room" }),
    );
    const review = normalizeReview(
      { score: 7, reviewDate: "2026-10-12T01:00:01.000Z" },
      "potts-point",
      now,
    );
    expect(validateReview(review, now)).toMatchObject({
      ok: false,
      reason: "review_date_in_future",
    });
  });

  it("makes repeated fixture input idempotent before database writes", () => {
    const first = prepareReviews(fixture, "olympic-paddington", now);
    const second = prepareReviews(fixture, "olympic-paddington", now);
    expect(first.rejected).toHaveLength(0);
    expect(new Set(first.accepted.map((review) => review.dedupeKey)).size).toBe(
      fixture.length,
    );
    expect(second.accepted.map((review) => review.dedupeKey)).toEqual(
      first.accepted.map((review) => review.dedupeKey),
    );
  });
});
