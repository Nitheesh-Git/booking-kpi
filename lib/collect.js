import { properties, staleAfterDays } from "../dashboard.config.js";
import { actorProfile, buildActorInput, normalizeActorId, overridesFor } from "./actors.js";
import * as apify from "./apify.js";
import { ingestPreparedReviews, prepareReviews } from "./ingest.js";
import { extractRating } from "./normalize.js";

const terminal = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);
const GIVE_UP_AFTER_MS = 3 * 86_400_000;
const DAY_MS = 86_400_000;

/** Overlap re-read on every run, so late-indexed reviews are not missed. */
export const OVERLAP_DAYS = 14;
/** How far back a property with no stored reviews is collected. */
export const BACKFILL_DAYS = 365;

/**
 * Date to collect from: newest stored review minus the overlap, or a year
 * back when nothing is stored. Returned as YYYY-MM-DD.
 */
export function cutoffFor(newestStored, now = new Date()) {
  const from = newestStored
    ? new Date(new Date(newestStored).getTime() - OVERLAP_DAYS * DAY_MS)
    : new Date(now.getTime() - BACKFILL_DAYS * DAY_MS);
  return from.toISOString().slice(0, 10);
}

/** Whether a current-generation run (one that records its actor) has stored data for the property. */
async function hasActorRun(database, propertyId) {
  const { data, error } = await database
    .from("scrape_runs")
    .select("id")
    .eq("property_id", propertyId)
    .in("status", ["ingested", "degraded"])
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function newestStoredReview(database, propertyId) {
  const { data, error } = await database
    .from("reviews")
    .select("review_date")
    .eq("property_id", propertyId)
    .order("review_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.review_date ?? null;
}

/**
 * Start one property's run on the first actor (from `fromRank` on) that
 * accepts it. Records actor, property and cutoff on the run row.
 */
async function startPropertyRun(database, environment, property, { trigger, fromRank = 0, cutoff, api = apify, max: maxOverride }) {
  const actors = api.configuredActors(environment).filter((a) => a.rank >= fromRank);
  if (!actors.length) return { propertyId: property.id, error: "No further actor configured" };
  const max = maxOverride ?? (Number(environment.APIFY_MAX_REVIEWS) || 300);
  const failures = [];
  for (const entry of actors) {
    const { data: row, error } = await database
      .from("scrape_runs")
      .insert({ trigger, status: "queued", actor: entry.actor, property_id: property.id, cutoff_date: cutoff })
      .select("id")
      .single();
    if (error) throw error;
    try {
      const schema = await api.getInputSchema(entry);
      const built = buildActorInput(schema, { url: property.bookingUrl, since: cutoff, max }, actorProfile(entry.actor));
      const input = { ...built.input, ...overridesFor(entry.actor, environment) };
      const started = await api.withRetry(() => api.startActorRun(entry, input), 2);
      const { error: linkError } = await database
        .from("scrape_runs")
        .update({ status: "running", apify_run_id: started.id })
        .eq("id", row.id);
      if (linkError)
        throw new Error(
          `Apify run ${started.id} started but could not be recorded (${linkError.message}). Ingest it with: npm run ingest-run -- ${started.id}`,
        );
      return { localRunId: row.id, apifyRunId: started.id, propertyId: property.id, actor: entry.actor, warnings: built.warnings };
    } catch (startError) {
      failures.push(`${entry.actor}: ${startError.message}`);
      await database
        .from("scrape_runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error: startError.message })
        .eq("id", row.id);
    }
  }
  return { propertyId: property.id, error: `All actors failed to start: ${failures.join("; ")}` };
}

/** Properties with a run started recently that did not fail. */
export const RESTART_AFTER_HOURS = 6;

async function recentlyStarted(database, now) {
  const since = new Date(now.getTime() - RESTART_AFTER_HOURS * 3_600_000).toISOString();
  const { data, error } = await database
    .from("scrape_runs")
    .select("property_id, status")
    .gte("started_at", since);
  if (error) throw error;
  return new Set(
    (data ?? [])
      .filter((r) => r.property_id && ["queued", "running", "ingested"].includes(r.status))
      .map((r) => r.property_id),
  );
}

/**
 * Start one run per property, incremental from the newest stored review.
 * Each property tries the actors in order until one starts.
 */
export async function startCollection(database, environment, trigger = "cli", { api = apify, now = new Date() } = {}) {
  if (!api.configuredActors(environment).length)
    throw new Error("No configured Apify actor and token pair");
  const results = [];
  const busy = await recentlyStarted(database, now);
  for (const property of properties) {
    if (busy.has(property.id)) {
      // A run started in the last few hours is still in flight or just
      // ingested: do not pay for the same work twice.
      results.push({ propertyId: property.id, skipped: "A run started in the last 6 hours" });
      continue;
    }
    try {
      // APIFY_SINCE (YYYY-MM-DD) forces a start date, for a one-off backfill.
      const forced = /^\d{4}-\d{2}-\d{2}$/.test(environment.APIFY_SINCE ?? "") ? environment.APIFY_SINCE : null;
      // A property never collected by the current actors gets a full backfill
      // once; after that, runs are incremental.
      const backfill = !forced && !(await hasActorRun(database, property.id));
      const cutoff = forced ?? (backfill ? cutoffFor(null, now) : cutoffFor(await newestStoredReview(database, property.id), now));
      const max = backfill ? Number(environment.APIFY_BACKFILL_MAX) || 1500 : undefined;
      results.push(await startPropertyRun(database, environment, property, { trigger, cutoff, api, max }));
    } catch (error) {
      results.push({ propertyId: property.id, error: error.message });
    }
  }
  return results;
}

/**
 * A run that returns only old reviews means the actor is not sorting newest
 * first (seen 2026-10-10: Potts Point's newest stored review was 11 weeks
 * old while reviews went back to 2023). Busy hotels get reviews every few
 * days, so nothing in the last RECENT_DAYS is treated as a collection fault.
 */
export const RECENT_DAYS = staleAfterDays;

/** Whole days since the newest review in a list, or null for an empty list. */
export function newestAgeDays(reviews, now = new Date()) {
  if (!reviews.length) return null;
  const newest = reviews.reduce((m, r) => (r.reviewDate > m ? r.reviewDate : m), "");
  return Math.floor((now.getTime() - new Date(newest).getTime()) / 86_400_000);
}

export function recencyProblem(reviews, now = new Date()) {
  const age = newestAgeDays(reviews, now);
  if (age == null || age <= RECENT_DAYS) return null;
  return `Newest review returned is ${age} days old; the actor may not be sorting newest first`;
}

/**
 * Which field names the actor sent (names only, never values) and which
 * review fields came out empty for every row. Stored on the run so a
 * mapping gap is visible on the Data health tab.
 */
export function fieldCoverage(items, accepted) {
  const keys = new Set();
  // Names only, one level deep for grouped fields (for example "stay.room").
  // The guest's name key may appear; its value never does.
  for (const item of items.slice(0, 20)) {
    for (const [key, value] of Object.entries(item ?? {})) {
      keys.add(key);
      if (value && typeof value === "object" && !Array.isArray(value))
        for (const sub of Object.keys(value)) keys.add(`${key}.${sub}`);
    }
  }
  const fields = {
    title: "title",
    likedText: "liked",
    dislikedText: "disliked",
    replyText: "reply",
    reviewerCountry: "country",
    travellerType: "traveller type",
    roomName: "room",
    stayDate: "stay date",
    nights: "nights",
    reviewUrl: "review link",
    sourceReviewId: "review id",
  };
  const missing = Object.entries(fields)
    .filter(([field]) => !accepted.some((r) => r[field] != null))
    .map(([, label]) => label);
  return `Fields sent: ${[...keys].sort().join(", ").slice(0, 1200)}${missing.length ? `. Empty in every row: ${missing.join(", ")}` : ""}`;
}

/** A batch whose scores never exceed 5 is almost certainly on a 1 to 5 scale. */
export function looksFivePoint(ratings) {
  return ratings.length >= 10 && Math.max(...ratings) <= 5;
}

async function markRun(database, localRunId, fields) {
  const { error } = await database
    .from("scrape_runs")
    .update({ finished_at: new Date().toISOString(), ...fields })
    .eq("id", localRunId);
  if (error) throw error;
}

/**
 * Ingest a finished Apify run. Safe to call repeatedly: ingest is idempotent.
 * Never deletes data. A failed, empty, stale or suspicious run is recorded on
 * its scrape_runs row and, when another actor is configured after the one
 * that ran, that actor is started for the same property (actor fallback).
 */
export async function ingestActorRun(database, environment, localRunId, apifyRunId, propertyId, { api = apify } = {}) {
  const { data: row, error: rowError } = await database
    .from("scrape_runs")
    .select("id, trigger, actor, property_id, cutoff_date")
    .eq("id", localRunId)
    .single();
  if (rowError) throw rowError;

  const actors = api.configuredActors(environment);
  let entry;
  let run;
  for (const candidate of actors) {
    try {
      run = await api.withRetry(() => api.getActorRun(candidate, apifyRunId), 2);
      entry = candidate;
      break;
    } catch {
      /* Try the next credential. */
    }
  }
  if (!run || !entry)
    throw new Error("Apify run cannot be read with configured credentials");
  if (!terminal.has(run.status)) return { status: run.status, complete: false };

  const actorId = normalizeActorId(row.actor ?? entry.actor);
  const rank = actors.find((a) => a.actor === actorId)?.rank ?? 0;
  let property = properties.find((p) => p.id === (row.property_id ?? propertyId));
  if (!property) {
    const input = await api.withRetry(() => api.getRunInput(entry, run), 2).catch(() => ({}));
    const urls = JSON.stringify(input);
    property = properties.find((p) => urls.includes(p.bookingUrl));
  }

  const fallback = async (reason) => {
    if (!property) return null;
    const next = await startPropertyRun(database, environment, property, {
      trigger: row.trigger ?? "cron",
      fromRank: rank + 1,
      cutoff: row.cutoff_date,
      api,
      max: Number(environment.APIFY_BACKFILL_MAX) || 1500,
    });
    return next.error ? { error: next.error, reason } : { ...next, reason };
  };

  if (run.status !== "SUCCEEDED") {
    await markRun(database, localRunId, { status: "failed", error: `Apify run finished as ${run.status}` });
    return { complete: true, failed: true, status: run.status, fallbackStarted: await fallback("run failed") };
  }
  if (!property) {
    await markRun(database, localRunId, { status: "failed", error: "Run does not map to a configured property" });
    return { complete: true, failed: true };
  }

  const items = await api.withRetry(() => api.getDatasetItems(entry, run.defaultDatasetId), 2);
  const reviewRows = items.filter((item) => extractRating(item) != null);
  if (!reviewRows.length) {
    // Likely a page change, a block or a wrong input. Keep existing data untouched.
    await markRun(database, localRunId, {
      status: "degraded",
      items_fetched: items.length,
      error: `No rows with a rating among ${items.length} dataset items`,
    });
    return { complete: true, propertyId: property.id, degraded: true, fallbackStarted: await fallback("empty dataset") };
  }

  const profile = actorProfile(actorId);
  if (profile.ratingScale === 10 && looksFivePoint(reviewRows.map(extractRating))) {
    // Never store a batch on a guessed scale; this is how scores were once doubled.
    await markRun(database, localRunId, {
      status: "degraded",
      items_fetched: reviewRows.length,
      error: `All ${reviewRows.length} scores are 5 or below; the actor may use a 1 to 5 scale. Not stored. Set its ratingScale in lib/actors.js after checking.`,
    });
    return { complete: true, propertyId: property.id, degraded: true, fallbackStarted: await fallback("suspicious scale") };
  }

  const prepared = prepareReviews(reviewRows, property.id, new Date(), { ratingScale: profile.ratingScale });
  const counts = await ingestPreparedReviews(database, localRunId, prepared);
  if (prepared.rejected.length) {
    const { error } = await database.from("rejected_items").insert(
      prepared.rejected.slice(0, 20).map((item) => ({ ...item, run_id: localRunId })),
    );
    if (error) console.error(`rejected_items insert failed: ${error.message}`);
  }
  const problems = [];
  if (counts.rejected / reviewRows.length > 0.2)
    problems.push(`${counts.rejected} of ${reviewRows.length} rows rejected`);
  const staleness = recencyProblem(prepared.accepted);
  if (staleness) problems.push(staleness);
  if (prepared.idsDropped) problems.push("Actor's review ids were not unique; content hashes used instead");
  const degraded = problems.length > 0;
  await markRun(database, localRunId, {
    status: degraded ? "degraded" : "ingested",
    notes: fieldCoverage(reviewRows, prepared.accepted),
    items_fetched: reviewRows.length,
    ...(degraded ? { error: problems.join("; ") } : {}),
    ...counts,
  });
  // Stale output means this actor cannot see new reviews: try the next one.
  const fallbackStarted = staleness ? await fallback("stale reviews") : null;
  return { complete: true, propertyId: property.id, actor: actorId, counts, degraded, fallbackStarted };
}

/**
 * Ingest every run still marked "running". This is how the daily cron picks
 * up the runs it started the day before, and how a missed run recovers.
 * One failing run never stops the others.
 */
export async function recoverRunningRuns(database, environment, { api = apify } = {}) {
  const { data, error } = await database
    .from("scrape_runs")
    .select("id, apify_run_id, started_at")
    .eq("status", "running")
    .not("apify_run_id", "is", null);
  if (error) throw error;
  const results = [];
  for (const run of data ?? []) {
    try {
      results.push({
        runId: run.id,
        ...(await ingestActorRun(database, environment, run.id, run.apify_run_id, undefined, { api })),
      });
    } catch (ingestError) {
      // Errors here are usually transient (Apify or network). Keep the run
      // "running" so the next collection retries it; give up after 3 days.
      const ageMs = Date.now() - new Date(run.started_at).getTime();
      if (ageMs > GIVE_UP_AFTER_MS)
        await markRun(database, run.id, {
          status: "failed",
          error: `Gave up after 3 days: ${ingestError.message}`,
        }).catch(() => {});
      results.push({ runId: run.id, error: ingestError.message, willRetry: ageMs <= GIVE_UP_AFTER_MS });
    }
  }
  return results;
}
