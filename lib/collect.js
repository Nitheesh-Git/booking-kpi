import { properties } from "../dashboard.config.js";
import {
  configuredActors,
  getActorRun,
  getDatasetItems,
  getRunInput,
  startActorRun,
  withRetry,
} from "./apify.js";
import { ingestPreparedReviews, prepareReviews } from "./ingest.js";

const terminal = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

export async function startCollection(database, environment, trigger = "cli") {
  const actors = configuredActors(environment);
  if (!actors.length)
    throw new Error("No configured Apify actor and token pair");
  const results = [];
  for (const property of properties) {
    const { data: run, error } = await database
      .from("scrape_runs")
      .insert({ trigger, status: "queued" })
      .select("id")
      .single();
    if (error) throw error;
    try {
      let started;
      let entry;
      for (const candidate of actors) {
        try {
          started = await withRetry(
            () => startActorRun(candidate, property),
            2,
          );
          entry = candidate;
          break;
        } catch {
          /* Try the configured fallback. */
        }
      }
      if (!started || !entry)
        throw new Error("All configured Apify actors failed to start");
      await database
        .from("scrape_runs")
        .update({ status: "running", apify_run_id: started.id })
        .eq("id", run.id);
      results.push({
        localRunId: run.id,
        apifyRunId: started.id,
        propertyId: property.id,
        actor: entry,
      });
    } catch (startError) {
      await database
        .from("scrape_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: startError.message,
        })
        .eq("id", run.id);
      results.push({
        localRunId: run.id,
        propertyId: property.id,
        error: startError.message,
      });
    }
  }
  return results;
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
 * Never deletes data. A failed, empty or unmappable run is recorded on its
 * scrape_runs row (failed or degraded) instead of being left as "running".
 */
export async function ingestActorRun(
  database,
  environment,
  localRunId,
  apifyRunId,
  propertyId,
) {
  const actors = configuredActors(environment);
  let entry;
  let run;
  for (const candidate of actors) {
    try {
      run = await withRetry(() => getActorRun(candidate, apifyRunId), 2);
      entry = candidate;
      break;
    } catch {
      /* Try the configured fallback credential. */
    }
  }
  if (!run || !entry)
    throw new Error("Apify run cannot be read with configured credentials");
  if (!terminal.has(run.status)) return { status: run.status, complete: false };
  if (run.status !== "SUCCEEDED") {
    await markRun(database, localRunId, {
      status: "failed",
      error: `Apify run finished as ${run.status}`,
    });
    return { complete: true, failed: true, status: run.status };
  }
  const input = await withRetry(() => getRunInput(entry, run), 2);
  const inputUrl = input.startUrls?.[0]?.url ?? input.startUrls?.[0];
  const property = properties.find(
    (candidate) =>
      candidate.id === propertyId || candidate.bookingUrl === inputUrl,
  );
  if (!property) {
    await markRun(database, localRunId, {
      status: "failed",
      error: "Run input does not map to a configured property",
    });
    return { complete: true, failed: true };
  }
  const items = await withRetry(
    () => getDatasetItems(entry, run.defaultDatasetId),
    2,
  );
  const reviewRows = items.filter((item) =>
    Number.isFinite(Number(item.score ?? item.rating)),
  );
  if (!reviewRows.length) {
    // Likely a page change or a block. Keep existing data untouched.
    await markRun(database, localRunId, {
      status: "degraded",
      items_fetched: items.length,
      error: `No rows with a rating among ${items.length} dataset items`,
    });
    return { complete: true, propertyId: property.id, degraded: true };
  }
  const prepared = prepareReviews(reviewRows, property.id);
  const counts = await ingestPreparedReviews(database, localRunId, prepared);
  if (prepared.rejected.length) {
    const { error } = await database.from("rejected_items").insert(
      prepared.rejected
        .slice(0, 20)
        .map((item) => ({ ...item, run_id: localRunId })),
    );
    if (error) console.error(`rejected_items insert failed: ${error.message}`);
  }
  const degraded = counts.rejected / reviewRows.length > 0.2;
  await markRun(database, localRunId, {
    status: degraded ? "degraded" : "ingested",
    items_fetched: reviewRows.length,
    ...(degraded
      ? { error: `${counts.rejected} of ${reviewRows.length} rows rejected` }
      : {}),
    ...counts,
  });
  return { complete: true, propertyId: property.id, counts, degraded };
}

/**
 * Ingest every run still marked "running". This is how the daily cron picks
 * up the runs it started the day before, and how a missed run recovers.
 * One failing run never stops the others.
 */
export async function recoverRunningRuns(database, environment) {
  const { data, error } = await database
    .from("scrape_runs")
    .select("id, apify_run_id")
    .eq("status", "running")
    .not("apify_run_id", "is", null);
  if (error) throw error;
  const results = [];
  for (const run of data ?? []) {
    try {
      results.push({
        runId: run.id,
        ...(await ingestActorRun(database, environment, run.id, run.apify_run_id)),
      });
    } catch (ingestError) {
      await markRun(database, run.id, {
        status: "failed",
        error: ingestError.message,
      }).catch(() => {});
      results.push({ runId: run.id, error: ingestError.message });
    }
  }
  return results;
}
