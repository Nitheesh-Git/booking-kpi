import { describe, expect, it } from "vitest";
import { enrichPending } from "../lib/enrich-runner.js";

/** Minimal in-memory stand-in for the Supabase calls the runner makes. */
function fakeDb(rows) {
  const enrichment = new Map(rows.map((r) => [r.review_id, { status: "pending", attempts: 0 }]));
  const topics = [];
  const db = {
    enrichment,
    topics,
    from(table) {
      const q = { table, filters: {}, op: "select", payload: null };
      const chain = {
        select: () => chain,
        eq: (k, v) => ((q.filters[k] = v), chain),
        lt: () => chain,
        order: () => chain,
        limit: async () => ({
          data: rows.filter((r) => enrichment.get(r.review_id).status === "pending").map((r) => ({ ...r, attempts: enrichment.get(r.review_id).attempts })),
          error: null,
        }),
        update: (payload) => ((q.op = "update"), (q.payload = payload), chain),
        delete: () => ((q.op = "delete"), chain),
        insert: async (list) => (topics.push(...list), { error: null }),
        then: (resolve) => {
          const id = q.filters.review_id;
          if (q.table === "review_enrichment" && q.op === "update") Object.assign(enrichment.get(id), q.payload);
          return resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return db;
}

const keys = { groq: ["k"], openrouter: [] };
const rows = [
  { review_id: "a", reviews: { title: null, liked_text: "Great location", disliked_text: "Dirty bathroom" } },
  { review_id: "b", reviews: { title: null, liked_text: null, disliked_text: null } },
  { review_id: "c", reviews: { title: null, liked_text: "Nice staff", disliked_text: null } },
];

const answer = (topicsList) =>
  JSON.stringify({ sentiment_score: 0.5, topics: topicsList });

describe("enrichPending", () => {
  it("tags text reviews, skips empty ones and drops invented evidence", async () => {
    const db = fakeDb(rows);
    const llm = async (_k, prompt) => ({
      provider: "test",
      model: "m",
      text: prompt.includes("Dirty bathroom")
        ? answer([
            { topic: "cleanliness", polarity: "negative", severity: 2, evidence: "Dirty bathroom" },
            { topic: "noise", polarity: "negative", severity: 2, evidence: "loud parties" },
          ])
        : answer([{ topic: "staff", polarity: "positive", severity: 2, evidence: "Nice staff" }]),
    });
    const totals = await enrichPending(db, keys, { llm, delayMs: 0 });
    expect(totals).toMatchObject({ done: 2, skipped: 1, failed: 0, droppedTags: 1 });
    expect(db.enrichment.get("b").status).toBe("skipped");
    expect(db.topics.map((t) => t.topic).sort()).toEqual(["cleanliness", "staff"]);
  });

  it("stops at the review budget and leaves the rest pending", async () => {
    const db = fakeDb(rows);
    const llm = async () => ({ provider: "t", model: "m", text: answer([]) });
    const totals = await enrichPending(db, keys, { llm, delayMs: 0, maxReviews: 1 });
    expect(totals.done).toBe(1);
    expect(totals.stoppedEarly).toBe(true);
    expect(db.enrichment.get("c").status).toBe("pending");
  });

  it("records a failure without stopping and does nothing with no keys", async () => {
    const db = fakeDb(rows);
    const llm = async () => ({ provider: "t", model: "m", text: "not json" });
    const totals = await enrichPending(db, keys, { llm, delayMs: 0 });
    expect(totals.failed).toBe(2);
    expect(db.enrichment.get("a")).toMatchObject({ status: "pending", attempts: 1 });
    expect((await enrichPending(fakeDb(rows), { groq: [], openrouter: [] })).done).toBe(0);
  });
});
