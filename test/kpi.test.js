import { describe, it, expect } from "vitest";
import { ratingKpis } from "../lib/kpi.js";

describe("ratingKpis", () => {
  it("returns nulls for empty dataset", async () => {
    const db = {
      from() {
        return {
          select() {
            return this;
          },
          gte() {
            return {
              then(r) {
                return r({ data: [], error: null });
              },
            };
          },
          eq() {
            return this;
          },
        };
      },
    };
    const result = await ratingKpis(db);
    expect(result.totalReviews).toBe(0);
    expect(result.averageRating).toBeNull();
  });

  it("calculates averages and bands correctly", async () => {
    const reviews = [
      { property_id: "p1", rating_10: 9 }, // positive
      { property_id: "p1", rating_10: 7 }, // neutral
      { property_id: "p1", rating_10: 5 }, // negative
      { property_id: "p1", rating_10: 8 }, // positive
    ];
    const db = {
      from() {
        return {
          select() {
            return this;
          },
          gte() {
            return this;
          },
          eq() {
            return this;
          },
          then(r) {
            return r({ data: reviews, error: null });
          },
        };
      },
    };
    const result = await ratingKpis(db);
    expect(result.totalReviews).toBe(4);
    expect(result.averageRating).toBe(7.25);
    expect(result.positiveCount).toBe(2); // >=8
    expect(result.negativeCount).toBe(1); // <6
    expect(result.neutralCount).toBe(1);
  });
});
