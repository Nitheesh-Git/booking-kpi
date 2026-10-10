const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
      actor,
      token: tokens[index % tokens.length],
      fallback: index > 0,
    }))
    .filter((entry) => entry.token);
}

async function apiRequest(path, token, options = {}) {
  const response = await fetch(
    `https://api.apify.com/v2/${path}?token=${encodeURIComponent(token)}`,
    { ...options, signal: AbortSignal.timeout(30_000) },
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `Apify HTTP ${response.status}: ${body.error?.message ?? "Unknown error"}`,
    );
  return body.data;
}

/**
 * Extra actor input from APIFY_INPUT_OVERRIDES (JSON), merged last.
 * Use it to set the actor's newest-first sort option once its exact input
 * name is confirmed in the actor's Apify input schema, for example
 * {"sortBy":"newest"}. Invalid JSON is ignored with a warning.
 */
export function inputOverrides(environment = {}) {
  const raw = environment.APIFY_INPUT_OVERRIDES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    console.warn("APIFY_INPUT_OVERRIDES is not valid JSON; ignoring it");
    return {};
  }
}

export function actorInput(property, fallback, environment = {}) {
  const maxReviews = Number(environment.APIFY_MAX_REVIEWS) || 100;
  const base = fallback
    ? {
        startUrls: [{ url: property.bookingUrl }],
        maxReviewsPerProperty: maxReviews,
        includeReplies: true,
      }
    : {
        startUrls: [property.bookingUrl],
        maxReviews,
        language: "en-gb",
        pageDelay: 1500,
        concurrency: 1,
      };
  return { ...base, ...inputOverrides(environment) };
}

export async function startActorRun(entry, property, environment = {}) {
  return apiRequest(
    `acts/${encodeURIComponent(entry.actor)}/runs`,
    entry.token,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(actorInput(property, entry.fallback, environment)),
    },
  );
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
