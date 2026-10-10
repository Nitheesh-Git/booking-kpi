import { describe, expect, it } from "vitest";
import { buildDashboard, filterFeed, ratingBand, stats } from "../lib/analytics.js";
import { resolvePeriods } from "../lib/weeks.js";

let n = 0;
// Hand-built cases for the arithmetic only; never shipped as sample data.
function review(propertyId, date, rating, topics = [], extra = {}) {
  n += 1;
  return {
    id: `r${n}`,
    propertyId,
    rating,
    reviewDate: `${date}T02:00:00.000Z`,
    title: null,
    liked: null,
    disliked: null,
    topics: topics.map(([topic, polarity, severity = 2]) => ({ topic, polarity, severity, evidence: topic })),
    ...extra,
  };
}

const today = "2026-10-10";
const periods = resolvePeriods({
  from: "2026-10-05",
  to: "2026-10-10",
  compareFrom: "2026-09-28",
  compareTo: "2026-10-04",
  today,
});

const reviews = [
  // This week, Darling Harbour
  review("darling-harbour", "2026-10-06", 4, [["cleanliness", "negative"], ["location", "positive"]]),
  review("darling-harbour", "2026-10-07", 5, [["cleanliness", "negative"], ["noise", "negative"]]),
  review("darling-harbour", "2026-10-08", 9, [["staff", "positive"]]),
  review("darling-harbour", "2026-10-08", 3, [["check_in", "negative", 3]]),
  review("darling-harbour", "2026-10-09", 7, [["location", "positive"]]),
  // This week, Potts Point
  review("potts-point", "2026-10-09", 10, [["location", "positive"]]),
  // Last week
  review("darling-harbour", "2026-09-29", 9),
  review("darling-harbour", "2026-09-30", 8),
  review("darling-harbour", "2026-10-01", 9),
  review("darling-harbour", "2026-10-02", 8, [["noise", "negative"]]),
  review("darling-harbour", "2026-10-03", 9),
];

describe("rating bands", () => {
  it("uses negative below 6 and positive at 8 or above", () => {
    expect(ratingBand(5.9)).toBe("negative");
    expect(ratingBand(6)).toBe("neutral");
    expect(ratingBand(7.9)).toBe("neutral");
    expect(ratingBand(8)).toBe("positive");
  });

  it("returns empty stats safely", () => {
    expect(stats([])).toMatchObject({ count: 0, average: null, negativeShare: null, lowVolume: true });
  });
});

describe("buildDashboard", () => {
  const d = buildDashboard({ reviews, periods, today });

  it("computes this week's average and the change against last week", () => {
    // (4+5+9+3+7+10)/6 = 6.33 ; (9+8+9+8+9)/5 = 8.6
    expect(d.summary.current.count).toBe(6);
    expect(d.summary.current.average).toBe(6.33);
    expect(d.summary.previous.average).toBe(8.6);
    expect(d.summary.delta.average).toBe(-2.27);
    expect(d.summary.current.negative).toBe(3);
  });

  it("breaks down every property, including ones without reviews", () => {
    expect(d.properties).toHaveLength(4);
    const dh = d.properties.find((p) => p.id === "darling-harbour");
    expect(dh.current).toMatchObject({ count: 5, average: 5.6 });
    expect(dh.delta.average).toBe(-3);
    expect(d.properties.find((p) => p.id === "central-sydney").current.count).toBe(0);
  });

  it("measures the share of negative reviews mentioning a topic", () => {
    const clean = d.topics.find((t) => t.topic === "cleanliness");
    expect(clean).toMatchObject({ complaints: 2, negativeReviews: 3, negativeMentioning: 2 });
    expect(clean.shareOfNegative).toBeCloseTo(2 / 3);
    expect(d.topComplaint.topic).toBe("cleanliness");
  });

  it("writes plain-language insight sentences with counts", () => {
    const texts = d.insights.map((i) => i.text);
    expect(texts[0]).toMatch(/^Average rating this week is 6\.3 out of 10 from 6 reviews, down 2\.3 points on last week/);
    expect(texts).toContain("67% of negative reviews this week mentioned cleanliness issues (2 of 3).");
  });

  it("flags a property drop, a negative burst and a severe issue", () => {
    const titles = d.attention.map((a) => a.title);
    expect(titles).toContain("Darling Harbour: rating dropped");
    expect(titles).toContain("Darling Harbour: 3 negative reviews in 7 days");
    expect(titles.some((t) => t.startsWith("Serious check-in issue"))).toBe(true);
  });

  it("returns 12 weekly trend points ending in the selected week", () => {
    expect(d.trend).toHaveLength(12);
    expect(d.trend.at(-1)).toMatchObject({ weekStart: "2026-10-05", count: 6, positive: 2, neutral: 1, negative: 3 });
    expect(d.trend.at(-2)).toMatchObject({ weekStart: "2026-09-28", count: 5, average: 8.6 });
  });

  it("filters the summary to one property", () => {
    const pp = buildDashboard({ reviews, periods, today, property: "potts-point" });
    expect(pp.summary.current).toMatchObject({ count: 1, average: 10, lowVolume: true });
    expect(pp.properties).toHaveLength(4);
  });
});

describe("filterFeed", () => {
  it("filters by topic polarity, sentiment and dates, newest first", () => {
    const out = filterFeed(reviews, { topic: "noise", polarity: "negative" });
    expect(out.total).toBe(2);
    expect(out.reviews[0].reviewDate > out.reviews[1].reviewDate).toBe(true);
    expect(filterFeed(reviews, { sentiment: "negative", from: "2026-10-05" }).total).toBe(3);
  });

  it("sorts lowest first and pages", () => {
    const out = filterFeed(reviews, { sort: "lowest", limit: 2, offset: 0 });
    expect(out.reviews.map((r) => r.rating)).toEqual([3, 4]);
    expect(out.total).toBe(reviews.length);
  });

  it("searches review text case-insensitively", () => {
    const withText = [review("potts-point", "2026-10-09", 6, [], { disliked: "The AIR CON was broken" })];
    expect(filterFeed(withText, { q: "air con" }).total).toBe(1);
  });
});
