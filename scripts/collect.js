/**
 * collect: start one run per property, wait for each, ingest it, and follow
 * any fallback runs the ingest starts (next actor in APIFY_ACTOR_ID).
 *
 * Usage:
 *   npm run collect
 *   APIFY_MAX_REVIEWS=1000 npm run collect      (larger cap for a backfill)
 */

import {
  ingestActorRun,
  recoverRunningRuns,
  startCollection,
} from "../lib/collect.js";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";

const POLL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60_000;

const environment = loadEnvironment();
const database = createDatabaseClient(environment);

// Finish anything a previous run left behind before starting new work.
for (const result of await recoverRunningRuns(database, environment)) {
  console.log(`recovered ${result.runId}: ${JSON.stringify(result)}`);
}

const queue = [];
for (const run of await startCollection(database, environment)) {
  if (run.error) console.error(`${run.propertyId}: ${run.error}`);
  else {
    if (run.warnings?.length) console.warn(`${run.propertyId} (${run.actor}): ${run.warnings.join("; ")}`);
    queue.push(run);
  }
}

while (queue.length) {
  const run = queue.shift();
  const started = Date.now();
  try {
    let result;
    while (Date.now() - started < MAX_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      result = await ingestActorRun(database, environment, run.localRunId, run.apifyRunId, run.propertyId);
      if (result.complete) break;
    }
    if (!result?.complete) {
      console.log(`${run.propertyId} (${run.actor}): still running, the next collect will ingest it`);
      continue;
    }
    console.log(`${run.propertyId} (${run.actor}): ${JSON.stringify({ ...result, fallbackStarted: undefined })}`);
    const next = result.fallbackStarted;
    if (next?.apifyRunId) {
      console.log(`${run.propertyId}: ${next.reason}, falling back to ${next.actor}`);
      queue.push(next);
    } else if (next?.error) {
      console.error(`${run.propertyId}: ${next.reason}, and no fallback could start: ${next.error}`);
    }
  } catch (error) {
    // One property failing must not stop the others.
    console.error(`${run.propertyId}: ${error.message}`);
  }
}
