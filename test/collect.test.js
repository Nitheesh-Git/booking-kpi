import { describe, expect, it } from "vitest";
import { cutoffFor, ingestActorRun, looksFivePoint, startCollection } from "../lib/collect.js";
import { guardSourceIds, prepareReviews } from "../lib/ingest.js";
import { extractRating, normalizeReview } from "../lib/normalize.js";

/** In-memory stand-in for the Supabase query builder calls collection makes. */
function fakeDb() {
  const tables = { scrape_runs: [], reviews: [], review_enrichment: [], rejected_items: [] };
  let seq = 0;
  const db = {
    tables,
    from(name) {
      const rows = tables[name];
      const q = { op: "select", filters: [], payload: null, single: false, limit: null, order: null };
      const match = (r) =>
        q.filters.every(([k, v, kind]) =>
          kind === "in" ? v.includes(r[k]) : kind === "gte" ? r[k] >= v : kind === "lte" ? r[k] <= v : r[k] === v,
        );
      const run = () => {
        if (q.op === "insert") {
          const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({ id: `id${++seq}`, ...p }));
          for (const row of list) if (name === "scrape_runs" && !row.started_at) row.started_at = new Date().toISOString();
          rows.push(...list);
          return q.single ? list[0] : list;
        }
        if (q.op === "upsert") {
          for (const p of [].concat(q.payload)) rows.push(p);
          return null;
        }
        if (q.op === "update") {
          rows.filter(match).forEach((r) => Object.assign(r, q.payload));
          return null;
        }
        let out = rows.filter(match);
        if (q.order) out = [...out].sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1));
        if (q.limit) out = out.slice(0, q.limit);
        return q.single ? out[0] : out;
      };
      const chain = {
        insert: (p) => ((q.op = "insert"), (q.payload = p), chain),
        upsert: (p) => ((q.op = "upsert"), (q.payload = p), chain),
        update: (p) => ((q.op = "update"), (q.payload = p), chain),
        select: () => chain,
        eq: (k, v) => (q.filters.push([k, v]), chain),
        in: (k, v) => (q.filters.push([k, v, "in"]), chain),
        gte: (k, v) => (q.filters.push([k, v, "gte"]), chain),
        lte: (k, v) => (q.filters.push([k, v, "lte"]), chain),
        range: () => chain,
        order: (k) => ((q.order = k), chain),
        limit: (n) => ((q.limit = n), chain),
        single: () => ((q.single = true), chain),
        then: (resolve, reject) => {
          try {
            resolve({ data: run(), error: null });
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    },
  };
  return db;
}

const env = {
  APIFY_API_TOKEN: "t",
  APIFY_ACTOR_ID: "apt_marble/booking-reviews-scraper,omkar-cloud/booking-reviews-scraper,scrapeunblocker/booking-reviews-scraper",
};

function fakeApi({ failStart = [], runs = {} } = {}) {
  const started = [];
  let n = 0;
  return {
    started,
    configuredActors: (e) =>
      e.APIFY_ACTOR_ID.split(",").map((actor, rank) => ({ actor, token: "t", rank, fallback: rank > 0 })),
    getInputSchema: async () => null,
    withRetry: (op) => op(),
    startActorRun: async (entry, input) => {
      if (failStart.includes(entry.actor)) throw new Error("Apify HTTP 500: down");
      const id = `run${++n}`;
      started.push({ id, actor: entry.actor, input });
      return { id };
    },
    getActorRun: async (_e, id) => runs[id]?.run ?? { status: "RUNNING" },
    getDatasetItems: async (_e, datasetId) => runs[datasetId]?.items ?? [],
    getRunInput: async () => ({}),
  };
}

const recent = (i) => ({
  reviewId: `r${i}`,
  score: (i % 10) + 1,
  positive: `liked ${i}`,
  reviewDate: new Date(Date.now() - i * 3_600_000).toISOString(),
});

describe("incremental cutoff", () => {
  it("reads from 14 days before the newest stored review, or a year back", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(cutoffFor("2026-10-08T05:00:00Z", now)).toBe("2026-09-24");
    expect(cutoffFor(null, now)).toBe("2025-10-10");
  });
});

describe("startCollection", () => {
  it("records actor, property and cutoff, and falls back when an actor will not start", async () => {
    const db = fakeDb();
    const api = fakeApi({ failStart: ["apt_marble/booking-reviews-scraper"] });
    const results = await startCollection(db, env, "cli", { api, now: new Date("2026-10-10T00:00:00Z") });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.actor === "omkar-cloud/booking-reviews-scraper")).toBe(true);
    const running = db.tables.scrape_runs.filter((r) => r.status === "running");
    expect(running[0]).toMatchObject({ actor: "omkar-cloud/booking-reviews-scraper", property_id: "olympic-paddington", cutoff_date: "2025-10-10" });
    expect(db.tables.scrape_runs.filter((r) => r.status === "failed")).toHaveLength(4);
    // First run with the new actors is a 12-month backfill with the larger cap.
    expect(api.started[0].input).toMatchObject({ sortBy: "newest", cutoffDate: "2025-10-10", maxReviewsPerHotel: 1500 });
  });
});

describe("ingestActorRun", () => {
  async function setup(items, runStatus = "SUCCEEDED") {
    const db = fakeDb();
    const api = fakeApi();
    const [first] = await startCollection(db, { ...env, APIFY_ACTOR_ID: env.APIFY_ACTOR_ID }, "cron", { api });
    // Only the first property matters here.
    api.getActorRun = async (_e, id) => (id === first.apifyRunId ? { status: runStatus, defaultDatasetId: "ds1" } : { status: "RUNNING" });
    api.getDatasetItems = async () => items;
    return { db, api, first };
  }

  it("ingests a good run with the actor's own scale and no fallback", async () => {
    const { db, api, first } = await setup(Array.from({ length: 12 }, (_, i) => recent(i)));
    const out = await ingestActorRun(db, env, first.localRunId, first.apifyRunId, undefined, { api });
    expect(out).toMatchObject({ complete: true, degraded: false, fallbackStarted: null, counts: { created: 12 } });
    expect(db.tables.reviews.map((r) => r.rating_10).sort((a, b) => a - b)[0]).toBe(1);
  });

  it("starts the next actor when a run returns nothing", async () => {
    const { db, api, first } = await setup([{ note: "blocked" }]);
    const out = await ingestActorRun(db, env, first.localRunId, first.apifyRunId, undefined, { api });
    expect(out.degraded).toBe(true);
    expect(out.fallbackStarted).toMatchObject({ actor: "omkar-cloud/booking-reviews-scraper", reason: "empty dataset", propertyId: first.propertyId });
  });

  it("starts the next actor when the run failed on Apify", async () => {
    const { db, api, first } = await setup([], "FAILED");
    const out = await ingestActorRun(db, env, first.localRunId, first.apifyRunId, undefined, { api });
    expect(out.fallbackStarted.actor).toBe("omkar-cloud/booking-reviews-scraper");
  });

  it("refuses to store a batch that looks like a 1 to 5 scale", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ ...recent(i), score: (i % 5) + 1 }));
    const { db, api, first } = await setup(items);
    const out = await ingestActorRun(db, env, first.localRunId, first.apifyRunId, undefined, { api });
    expect(out.degraded).toBe(true);
    expect(db.tables.reviews).toHaveLength(0);
    expect(db.tables.scrape_runs.find((r) => r.id === first.localRunId).error).toMatch(/1 to 5 scale/);
  });

  it("falls back when the actor only returns old reviews, but keeps what it got", async () => {
    const old = Array.from({ length: 12 }, (_, i) => ({ ...recent(i), reviewDate: "2025-01-01T00:00:00.000Z", reviewId: `o${i}` }));
    const { db, api, first } = await setup(old);
    const out = await ingestActorRun(db, env, first.localRunId, first.apifyRunId, undefined, { api });
    expect(out.counts.created).toBe(12);
    expect(out.fallbackStarted.reason).toBe("stale reviews");
  });
});

describe("output normalisation across actors", () => {
  it("reads alternative field names, text scores and plain dates", () => {
    const r = normalizeReview(
      {
        reviewScore: "Scored 8,0",
        positiveText: "Great spot",
        negativeText: "Noisy",
        reviewTitle: "Nice",
        publishedDate: "2026-10-03",
        guestCountry: "Australia",
        tripType: "Couple",
        roomType: "Pod",
        stayLength: "2 nights",
        ownerResponse: "Thanks",
        reviewer: { name: "Never stored" },
        url: "https://www.booking.com/hotel/au/x.html",
      },
      "potts-point",
    );
    expect(r).toMatchObject({
      rating10: 8,
      likedText: "Great spot",
      dislikedText: "Noisy",
      title: "Nice",
      reviewDate: "2026-10-03T00:00:00.000Z",
      reviewerCountry: "Australia",
      travellerType: "Couple",
      roomName: "Pod",
      nights: 2,
      replyText: "Thanks",
      reviewUrl: null,
    });
    expect(JSON.stringify(r)).not.toMatch(/Never stored/);
  });

  it("extracts ratings only when present", () => {
    expect(extractRating({ score: 9 })).toBe(9);
    expect(extractRating({ rating: "7.5" })).toBe(7.5);
    expect(extractRating({ text: "no score" })).toBeNull();
    expect(looksFivePoint([1, 2, 3, 4, 5, 5, 4, 3, 2, 1])).toBe(true);
    expect(looksFivePoint([1, 2, 3, 4, 5, 6, 4, 3, 2, 1])).toBe(false);
  });
});

describe("id safety", () => {
  it("ignores a review id shared by different reviews", () => {
    const items = [0, 1, 2].map((i) => ({ ...recent(i), reviewId: "hotel-123" }));
    const prepared = prepareReviews(items, "potts-point");
    expect(prepared.idsDropped).toBe(true);
    expect(new Set(prepared.accepted.map((r) => r.dedupeKey)).size).toBe(3);
    expect(guardSourceIds({ accepted: [], rejected: [] }).idsDropped).toBeUndefined();
  });

  it("drops an exact repeat inside one batch", () => {
    const prepared = prepareReviews([recent(1), recent(1)], "potts-point");
    expect(prepared.accepted).toHaveLength(1);
  });
});

describe("cross-actor duplicates", () => {
  it("recognises a stored review collected again under a different id", async () => {
    const db = fakeDb();
    const api = fakeApi();
    const [first] = await startCollection(db, env, "cron", { api });
    api.getActorRun = async () => ({ status: "SUCCEEDED", defaultDatasetId: "ds" });
    const original = { reviewId: "A1", score: 4, positive: "Location", negative: "Dirty  room", reviewDate: new Date().toISOString() };
    api.getDatasetItems = async () => [original];
    await ingestActorRun(db, env, first.localRunId, first.apifyRunId, undefined, { api });
    expect(db.tables.reviews).toHaveLength(1);

    // Another actor: other id, date only, slightly different spacing.
    // Seven hours later, past the double-start guard.
    const [second] = await startCollection(db, env, "cron", { api, now: new Date(Date.now() + 7 * 3_600_000) });
    api.getDatasetItems = async () => [
      { id: "other-777", rating: "4", likedText: "Location", dislikedText: "Dirty room", date: original.reviewDate.slice(0, 10) },
    ];
    const out = await ingestActorRun(db, env, second.localRunId, second.apifyRunId, undefined, { api });
    expect(out.counts).toMatchObject({ created: 0, unchanged: 1 });
    expect(db.tables.reviews).toHaveLength(1);
  });

  it("prefers Booking's own review id from the link over an actor id", () => {
    const r = normalizeReview(
      { id: "actor-1", score: 8, reviewUrl: "https://www.booking.com/hotel/au/x.html?selected_review_id=abc123", reviewDate: "2026-10-01T00:00:00Z" },
      "potts-point",
    );
    expect(r.sourceReviewId).toBe("abc123");
  });
});

describe("double triggering", () => {
  it("does not start a second run for a property started in the last 6 hours", async () => {
    const db = fakeDb();
    const api = fakeApi();
    await startCollection(db, env, "manual", { api });
    const again = await startCollection(db, env, "manual", { api });
    expect(again.every((r) => r.skipped)).toBe(true);
    expect(api.started).toHaveLength(4);
  });
});

describe("backfill once, then incremental", () => {
  it("switches to incremental after a successful run for the property", async () => {
    const db = fakeDb();
    const api = fakeApi();
    db.tables.scrape_runs.push({ id: "old", property_id: "potts-point", status: "ingested", started_at: "2026-10-01T00:00:00Z" });
    db.tables.reviews.push({ id: "r", property_id: "potts-point", review_date: "2026-10-05T00:00:00.000Z" });
    await startCollection(db, env, "cron", { api, now: new Date("2026-10-10T00:00:00Z") });
    const potts = api.started.find((s) => s.input.startUrls[0].url.includes("venus-potts-point"));
    expect(potts.input).toMatchObject({ onlyReviewsSince: "2026-09-21", maxReviewsPerHotel: 300 });
  });
});
