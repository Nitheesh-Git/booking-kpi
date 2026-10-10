import { describe, expect, it } from "vitest";
import { keywordTags } from "../lib/baseline.js";
import { scoreTags } from "../lib/evaluate.js";

describe("keyword baseline", () => {
  it("reads liked text as praise and disliked text as complaints", () => {
    const tags = keywordTags({ liked: "Great location near the station", disliked: "Dirty shower" });
    expect(tags).toContainEqual({ topic: "location", polarity: "positive" });
    expect(tags).toContainEqual({ topic: "cleanliness", polarity: "negative" });
    expect(tags).toContainEqual({ topic: "facilities", polarity: "negative" });
  });
});

describe("scoreTags", () => {
  it("computes per-tag and overall precision and recall", () => {
    const result = scoreTags([
      { id: "1", expected: [{ topic: "noise", polarity: "negative" }], predicted: [{ topic: "noise", polarity: "negative" }] },
      { id: "2", expected: [{ topic: "noise", polarity: "negative" }], predicted: [{ topic: "staff", polarity: "negative" }] },
    ]);
    const noise = result.rows.find((r) => r.tag === "noise:negative");
    expect(noise).toMatchObject({ tp: 1, fn: 1, precision: 1, recall: 0.5 });
    expect(result.overall).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
    expect(result.failures).toEqual([{ id: "2", missed: ["noise:negative"], extra: ["staff:negative"] }]);
  });
});
