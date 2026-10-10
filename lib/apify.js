import { apiActorId, normalizeActorId } from "./actors.js";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Actors in priority order from APIFY_ACTOR_ID (comma-separated). Tokens in
 * APIFY_API_TOKEN pair by position; one token may serve all actors.
 */
export function configuredActors(environment) {
  const values = (name) =>
    (environment[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const actors = values("APIFY_ACTOR_ID");
  const tokens = values("APIFY_API_TOKEN");
  return actors
    .map((actor, index) => ({
      actor: normalizeActorId(actor),
      token: tokens[index % tokens.length],
      fallback: index > 0,
      rank: index,
    }))
    .filter((entry) => entry.token);
}

async function apiRequest(path, token, options = {}) {
  const response = await fetch(
    `https://api.apify.com/v2/${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`,
    { ...options, signal: AbortSignal.timeout(30_000) },
  );
  let body = {};
  try {
    body = await response.json();
  } catch {
    /* Non-JSON error page. */
  }
  if (!response.ok)
    throw new Error(
      `Apify HTTP ${response.status}: ${body.error?.message ?? "Unknown error"}`,
    );
  return body.data;
}

const schemaCache = new Map();

/**
 * The actor's published input schema, or null if it cannot be read.
 * Tries the default build first, then the latest tagged build.
 */
export async function getInputSchema(entry) {
  if (schemaCache.has(entry.actor)) return schemaCache.get(entry.actor);
  const id = apiActorId(entry.actor);
  let schema = null;
  try {
    const build = await apiRequest(`acts/${id}/builds/default`, entry.token);
    schema = parseSchema(build?.inputSchema);
  } catch {
    /* Older API shape; try the tagged build. */
  }
  if (!schema) {
    try {
      const actor = await apiRequest(`acts/${id}`, entry.token);
      const buildId = actor?.taggedBuilds?.latest?.buildId;
      if (buildId) schema = parseSchema((await apiRequest(`actor-builds/${buildId}`, entry.token))?.inputSchema);
    } catch {
      /* Fall back to the built-in profile. */
    }
  }
  schemaCache.set(entry.actor, schema);
  return schema;
}

function parseSchema(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** @param {{ actor: string; token: string }} entry @param {object} input */
export async function startActorRun(entry, input) {
  return apiRequest(`acts/${apiActorId(entry.actor)}/runs`, entry.token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getActorRun(entry, runId) {
  return apiRequest(`actor-runs/${runId}`, entry.token);
}

export async function getDatasetItems(entry, datasetId) {
  const response = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&token=${encodeURIComponent(entry.token)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Apify dataset HTTP ${response.status}`);
  return response.json();
}

export async function getRunInput(entry, run) {
  const response = await fetch(
    `https://api.apify.com/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT?token=${encodeURIComponent(entry.token)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Apify input HTTP ${response.status}`);
  return response.json();
}

export async function withRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await delay(500 * 2 ** attempt);
    }
  }
  throw lastError;
}
