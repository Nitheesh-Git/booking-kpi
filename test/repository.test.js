import { describe, expect, it } from "vitest";
import { createFileSource, fromDatabaseRow, propertyDataIssues, summarizeHealth } from "../lib/repository.js";

const now = new Date("2026-10-10T00:00:00Z");
const day = (d) => `${d}T00:00:00.000Z`;

describe("propertyDataIssues", () => {
  it("passes recent, varied data", () => {
    const reviews = Array.from({ length: 60 }, (_, i) => ({ reviewDate: day("2026-10-08"), rating: (i % 10) + 1 }));
    expect(propertyDataIssues(reviews, now)).toEqual([]);
  });

  it("flags stale data and a suspiciously narrow score band", () => {
    const reviews = Array.from({ length: 100 }, (_, i) => ({ reviewDate: day("2026-07-26"), rating: 5 + (i % 3) }));
    const issues = propertyDataIssues(reviews, now);
    expect(issues[0]).toMatch(/newer than 76 days/);
    expect(issues[1]).toMatch(/between 5 and 7/);
  });

  it("does not flag an excellent property that only scores 8 to 10", () => {
    const reviews = Array.from({ length: 60 }, (_, i) => ({ reviewDate: day("2026-10-08"), rating: 8 + (i % 3) }));
    expect(propertyDataIssues(reviews, now)).toEqual([]);
  });

  it("flags a property with nothing stored", () => {
    expect(propertyDataIssues([], now)).toEqual(["No reviews stored."]);
  });
});

describe("summarizeHealth", () => {
  it("needs attention when any property has an issue or the last run failed", () => {
    const fresh = ["olympic-paddington", "potts-point", "central-sydney", "darling-harbour"].flatMap((propertyId) =>
      Array.from({ length: 5 }, (_, i) => ({ propertyId, reviewDate: day("2026-10-09"), rating: i + 5 })),
    );
    expect(summarizeHealth({ reviews: fresh, enrichment: [], runs: [], source: "test", now }).status).toBe("ok");
    const failedYesterday = { status: "failed", finished_at: "2026-10-09T05:00:00Z" };
    const startedToday = { status: "running", started_at: "2026-10-09T19:00:00Z" };
    // The newest row is a fresh run; the failure behind it must still count.
    expect(summarizeHealth({ reviews: fresh, enrichment: [], runs: [startedToday, failedYesterday], source: "test", now }).status).toBe("attention");
    const failedLastMonth = { status: "failed", finished_at: "2026-09-01T05:00:00Z" };
    expect(summarizeHealth({ reviews: fresh, enrichment: [], runs: [failedLastMonth], source: "test", now }).status).toBe("ok");
    expect(summarizeHealth({ reviews: fresh.slice(5), enrichment: [], runs: [], source: "test", now }).status).toBe("attention");
  });
});

describe("data sources", () => {
  it("maps database rows to the canonical shape without reviewer fields", () => {
    const r = fromDatabaseRow({
      id: "x", property_id: "potts-point", rating_10: "7.0", review_date: "2026-10-01T01:00:00+00:00",
      review_enrichment: [{ status: "done", sentiment_score: "0.40" }],
      review_topics: [{ topic: "noise", polarity: "negative", severity: 2, evidence: "loud" }],
    });
    expect(r).toMatchObject({ rating: 7, sentiment: 0.4, enrichmentStatus: "done", reviewDate: "2026-10-01T01:00:00.000Z" });
    expect(Object.keys(r)).not.toContain("reviewer");
  });

  it("judges the saved sample as of its export date", async () => {
    const health = await createFileSource("data/sample/reviews.json").loadHealth();
    const olympic = health.properties.find((p) => p.id === "olympic-paddington");
    expect(olympic.issues).toEqual([]);
  });

  it("reads the committed real sample", async () => {
    const source = createFileSource("data/sample/reviews.json");
    const all = await source.loadReviews({ fromUtc: "2000-01-01T00:00:00Z", toUtc: "2100-01-01T00:00:00Z" });
    expect(all.length).toBeGreaterThan(300);
    for (const r of all.slice(0, 50)) {
      expect(r.rating).toBeGreaterThanOrEqual(1);
      expect(r.rating).toBeLessThanOrEqual(10);
      expect(r).not.toHaveProperty("reviewer");
    }
  });
});
