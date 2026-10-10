import {
  ingestActorRun,
  recoverRunningRuns,
  startCollection,
} from "../lib/collect.js";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";

const environment = loadEnvironment();
const database = createDatabaseClient(environment);

// Finish anything a previous run left behind before starting new work.
for (const result of await recoverRunningRuns(database, environment)) {
  console.log(`recovered ${result.runId}: ${JSON.stringify(result)}`);
}

const runs = await startCollection(database, environment);
for (const run of runs) {
  if (run.error) {
    console.error(`${run.propertyId}: ${run.error}`);
    continue;
  }
  let result;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      result = await ingestActorRun(
        database,
        environment,
        run.localRunId,
        run.apifyRunId,
        run.propertyId,
      );
      if (result.complete) break;
    }
    console.log(
      `${run.propertyId}: ${result?.complete ? JSON.stringify(result) : "still running, the next collect will ingest it"}`,
    );
  } catch (error) {
    // One property failing must not stop the others.
    console.error(`${run.propertyId}: ${error.message}`);
  }
}
