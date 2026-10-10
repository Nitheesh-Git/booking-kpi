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
  it("never doubles a low ten point score", () => {
    const review = normalizeReview(
      { rating: 4, datetime: "2026-10-01T00:00:00.000Z" },
      "olympic-paddington",
    );
    expect(review.rating10).toBe(4);
    expect(review.ratingScale).toBe(10);
    expect(review.ratingPrecision).toBe("exact");
  });

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

  it("converts five point scores only when the source says so", () => {
    const review = normalizeReview(
      { rating: 4, datetime: "2026-10-01T00:00:00.000Z" },
      "potts-point",
      now,
      { ratingScale: 5 },
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

describe("collection recency check", () => {
  it("flags a run whose newest review is weeks old", async () => {
    const { recencyProblem } = await import("../lib/collect.js");
    const now = new Date("2026-10-10T00:00:00Z");
    expect(recencyProblem([{ reviewDate: "2026-10-08T00:00:00Z" }], now)).toBeNull();
    expect(recencyProblem([{ reviewDate: "2026-07-26T00:00:00Z" }, { reviewDate: "2024-01-01T00:00:00Z" }], now)).toMatch(/76 days old/);
  });

  it("merges actor input overrides and a larger backfill cap", async () => {
    const { actorInput } = await import("../lib/apify.js");
    const input = actorInput({ bookingUrl: "https://example.test/h.html" }, false, {
      APIFY_MAX_REVIEWS: "400",
      APIFY_INPUT_OVERRIDES: '{"sortBy":"newest"}',
    });
    expect(input).toMatchObject({ maxReviews: 400, sortBy: "newest", startUrls: ["https://example.test/h.html"] });
    expect(actorInput({ bookingUrl: "x" }, false, { APIFY_INPUT_OVERRIDES: "not json" }).maxReviews).toBe(100);
  });
});

describe("actor detection", () => {
  it("identifies the fallback actor from the run input, not the credential", async () => {
    const { ranOnFallback } = await import("../lib/collect.js");
    const { actorInput } = await import("../lib/apify.js");
    const property = { bookingUrl: "https://example.test/h.html" };
    expect(ranOnFallback(actorInput(property, true))).toBe(true);
    expect(ranOnFallback(actorInput(property, false))).toBe(false);
  });
});

describe("prompt building", () => {
  it("inserts review text literally, even with $ patterns and placeholders", async () => {
    const { buildPrompt } = await import("../lib/enrich.js");
    const prompt = buildPrompt({ title: "{{liked}}", likedText: "cost $'extra' $&", dislikedText: null });
    expect(prompt).toContain("Title: {{liked}}");
    expect(prompt).toContain("Liked: cost $'extra' $&");
  });
});

describe("sample round trip", () => {
  it("re-ingests the committed sample with no rejections and real scores", async () => {
    const { readFileSync } = await import("node:fs");
    const { reviews } = JSON.parse(readFileSync("data/sample/reviews.json", "utf8"));
    for (const id of ["olympic-paddington", "potts-point", "central-sydney", "darling-harbour"]) {
      const items = reviews.filter((r) => r.propertyId === id);
      const prepared = prepareReviews(items, id, new Date("2026-10-11T00:00:00Z"), { ratingScale: 10 });
      expect(prepared.rejected).toEqual([]);
      prepared.accepted.forEach((r, i) => {
        expect(r.rating10).toBe(items[i].rating);
        expect(r.likedText).toBe(items[i].liked ?? null);
      });
      expect(new Set(prepared.accepted.map((r) => r.dedupeKey)).size).toBe(items.length);
    }
  });
});
