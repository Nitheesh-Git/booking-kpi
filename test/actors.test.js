import { describe, expect, it } from "vitest";
import { actorProfile, apiActorId, buildActorInput, overridesFor } from "../lib/actors.js";

const intent = { url: "https://www.booking.com/hotel/au/x.html", since: "2026-09-01", max: 300 };

describe("buildActorInput", () => {
  it("maps an apt_marble-style schema: object URLs, newest enum, since date", () => {
    const schema = {
      properties: {
        startUrls: { type: "array", editor: "requestListSources" },
        sortBy: { type: "string", enum: ["most_relevant", "newest_first", "oldest_first"] },
        onlyReviewsSince: { type: "string", editor: "datepicker" },
        maxReviewsPerHotel: { type: "integer", maximum: 5000 },
      },
    };
    const { input, warnings } = buildActorInput(schema, intent, actorProfile("apt_marble/booking-reviews-scraper"));
    expect(input).toEqual({
      startUrls: [{ url: intent.url }],
      sortBy: "newest_first",
      onlyReviewsSince: "2026-09-01",
      maxReviewsPerHotel: 300,
    });
    expect(warnings).toEqual([]);
  });

  it("maps an omkar-cloud-style schema: string URLs, cutoffDate, capped max", () => {
    const schema = {
      properties: {
        startUrls: { type: "array", items: { type: "string" } },
        sortBy: { type: "string", enum: ["relevance", "newest", "oldest"] },
        cutoffDate: { type: "string" },
        maxReviewsPerHotel: { type: "integer", maximum: 200 },
      },
    };
    const { input } = buildActorInput(schema, intent, actorProfile("omkar-cloud/booking-reviews-scraper"));
    expect(input).toEqual({ startUrls: [intent.url], sortBy: "newest", cutoffDate: "2026-09-01", maxReviewsPerHotel: 200 });
  });

  it("never guesses a sort value and warns about what it could not map", () => {
    const schema = { properties: { url: { type: "string" }, sort: { type: "string" } } };
    const { input, warnings } = buildActorInput(schema, intent, actorProfile("x/y"));
    expect(input).toEqual({ url: intent.url });
    expect(warnings.join(" ")).toMatch(/cap.*sort.*cutoff/is);
  });

  it("uses the built-in profile when the schema is unavailable", () => {
    const { input, mapped } = buildActorInput(null, intent, actorProfile("omkar-cloud/booking-reviews-scraper"));
    expect(mapped).toBe("profile");
    expect(input).toMatchObject({ sortBy: "newest", cutoffDate: "2026-09-01" });
  });
});

describe("actor ids and overrides", () => {
  it("uses owner~name in API paths", () => {
    expect(apiActorId("apt_marble/booking-reviews-scraper")).toBe("apt_marble~booking-reviews-scraper");
    expect(actorProfile("apt_marble~booking-reviews-scraper").label).toBe("apt_marble");
  });

  it("applies flat overrides to all actors and keyed ones per actor", () => {
    expect(overridesFor("a/b", { APIFY_INPUT_OVERRIDES: '{"language":"en"}' })).toEqual({ language: "en" });
    const keyed = { APIFY_INPUT_OVERRIDES: '{"a/b":{"sortBy":"x"},"c/d":{"sortBy":"y"}}' };
    expect(overridesFor("c~d", keyed)).toEqual({ sortBy: "y" });
    expect(overridesFor("e/f", keyed)).toEqual({});
    expect(overridesFor("a/b", { APIFY_INPUT_OVERRIDES: "not json" })).toEqual({});
  });
});
