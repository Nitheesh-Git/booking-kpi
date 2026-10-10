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
      run = await getActorRun(candidate, apifyRunId);
      entry = candidate;
      break;
    } catch {
      /* Try the configured fallback credential. */
    }
  }
  if (!run || !entry)
    throw new Error("Apify run cannot be read with configured credentials");
  if (!terminal.has(run.status)) return { status: run.status, complete: false };
  if (run.status !== "SUCCEEDED")
    throw new Error(`Apify run finished as ${run.status}`);
  const input = await getRunInput(entry, run);
  const inputUrl = input.startUrls?.[0]?.url ?? input.startUrls?.[0];
  const property = properties.find(
    (candidate) =>
      candidate.id === propertyId || candidate.bookingUrl === inputUrl,
  );
  if (!property)
    throw new Error("Run input does not map to a configured property");
  const items = await getDatasetItems(entry, run.defaultDatasetId);
  const reviewRows = items.filter((item) =>
    Number.isFinite(Number(item.score ?? item.rating)),
  );
  if (!reviewRows.length)
    throw new Error("Actor dataset has no valid review rows");
  const prepared = prepareReviews(reviewRows, property.id);
  const counts = await ingestPreparedReviews(database, localRunId, prepared);
  if (prepared.rejected.length)
    await database
      .from("rejected_items")
      .insert(
        prepared.rejected
          .slice(0, 20)
          .map((item) => ({ ...item, run_id: localRunId })),
      );
  const degraded = counts.rejected / reviewRows.length > 0.2;
  await database
    .from("scrape_runs")
    .update({
      status: degraded ? "degraded" : "ingested",
      finished_at: new Date().toISOString(),
      items_fetched: reviewRows.length,
      ...counts,
    })
    .eq("id", localRunId);
  return { complete: true, propertyId: property.id, counts, degraded };
}
