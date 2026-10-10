/**
 * Shared request handler for the local server (server.js) and Vercel (api/index.js).
 *
 * Public, read-only:
 *   GET /api/config     properties, topics, thresholds, today in Sydney
 *   GET /api/dashboard  KPIs, comparison, property breakdown, trends, topics, insights, flags
 *   GET /api/reviews    review feed with filters, search, sort and paging
 *   GET /api/health     data freshness, enrichment progress and recent collection runs
 *
 * Protected (fail closed, see lib/auth.js):
 *   GET /api/collect    daily Vercel cron: ingest finished runs, then start new ones
 *   GET /api/enrich     AI tagging continuation, started by /api/collect (lib/continue-enrich.js)
 */

import { waitUntil } from "@vercel/functions";

import {
  properties,
  thresholds,
  timezone,
  topicLabels,
  topics,
  trendWeeks,
} from "./dashboard.config.js";
import { buildDashboard, filterFeed } from "./lib/analytics.js";
import { checkBearer } from "./lib/auth.js";
import { IDLE_WAIT_MS } from "./lib/continue-enrich.js";
import { loadEnvironment } from "./lib/env.js";
import { createSource } from "./lib/repository.js";
import {
  addDays,
  isLocalDate,
  localDate,
  resolvePeriods,
  startOfLocalDay,
  weekStart,
} from "./lib/weeks.js";

let cachedSource;
let cachedEnvironment;

function environment() {
  cachedEnvironment ??= loadEnvironment();
  return cachedEnvironment;
}

function source() {
  if (cachedSource === undefined) cachedSource = createSource(environment());
  return cachedSource;
}

/** Test hook: inject a data source and environment. */
export function __setSource(value, env = {}) {
  cachedSource = value;
  cachedEnvironment = env;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, statusCode, data, cache = "no-store") {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": cache,
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function requireSource() {
  const s = source();
  if (!s)
    throw new HttpError(
      503,
      "No data source configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or add data/sample/reviews.json.",
    );
  return s;
}

function readProperty(params) {
  const value = params.get("property");
  if (!value || value === "all") return null;
  if (!properties.some((p) => p.id === value))
    throw new HttpError(400, `Unknown property '${value}'`);
  return value;
}

function readDate(params, name) {
  const value = params.get(name);
  if (!value) return null;
  if (!isLocalDate(value)) throw new HttpError(400, `'${name}' must be YYYY-MM-DD`);
  return value;
}

function readEnum(params, name, allowed) {
  const value = params.get(name);
  if (!value) return null;
  if (!allowed.includes(value))
    throw new HttpError(400, `'${name}' must be one of ${allowed.join(", ")}`);
  return value;
}

const today = () => localDate(new Date(), timezone);
const utcRange = (from, to) => ({
  fromUtc: startOfLocalDay(from, timezone),
  toUtc: startOfLocalDay(addDays(to, 1), timezone),
});

async function dashboard(params) {
  const now = today();
  let periods;
  try {
    periods = resolvePeriods({
      from: readDate(params, "from"),
      to: readDate(params, "to"),
      compareFrom: readDate(params, "compareFrom"),
      compareTo: readDate(params, "compareTo"),
      today: now,
    });
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(400, error.message);
    throw error;
  }
  const property = readProperty(params);
  const trendStart = addDays(weekStart(periods.current.to), -7 * (trendWeeks - 1));
  const loadFrom = [periods.previous.from, trendStart, addDays(now, -6)].sort()[0];
  const loadTo = [periods.current.to, now].sort().at(-1);
  const reviews = await requireSource().loadReviews(utcRange(loadFrom, loadTo));
  return { today: now, ...buildDashboard({ reviews, periods, property, today: now }) };
}

async function feed(params) {
  const from = readDate(params, "from");
  const to = readDate(params, "to") ?? today();
  const reviews = await requireSource().loadReviews(
    utcRange(from ?? "2000-01-01", to),
  );
  return filterFeed(reviews, {
    property: readProperty(params),
    from,
    to,
    sentiment: readEnum(params, "sentiment", ["positive", "neutral", "negative"]),
    topic: readEnum(params, "topic", [...topics]),
    polarity: readEnum(params, "polarity", ["positive", "negative"]),
    q: params.get("q"),
    sort: readEnum(params, "sort", ["newest", "oldest", "lowest", "highest"]) ?? "newest",
    limit: Number(params.get("limit") ?? 20),
    offset: Number(params.get("offset") ?? 0),
  });
}

function requireCronSecret(request) {
  const auth = checkBearer(
    request.headers?.authorization,
    environment().CRON_SECRET,
  );
  if (!auth.ok) throw new HttpError(auth.status, auth.error);
}

/** Function limit is 300 s (vercel.json); keep 30 s for the last LLM call and the hand-off. */
const TAG_BUDGET_MS = 270_000;

/**
 * Tag one time-boxed batch of pending reviews, then hand the rest to the next
 * hop if there is more to do (see lib/continue-enrich.js).
 *
 * @param {number} hop  0 for the cron, 1+ for continuations
 * @param {number} requestStarted  ms timestamp the function call began
 * @param {number} [idle]  rate-limited hops in a row before this one
 */
async function enrichBatch(hop, requestStarted, idle = 0) {
  const [
    { createDatabaseClient },
    { enrichPending },
    { resolvedLlmKeys },
    { shouldContinue, startNextHop },
  ] = await Promise.all([
    import("./lib/db.js"),
    import("./lib/enrich-runner.js"),
    import("./lib/llm.js"),
    import("./lib/continue-enrich.js"),
  ]);
  const db = createDatabaseClient(environment());
  const keys = resolvedLlmKeys(environment());
  const enriched = { done: 0, failed: 0, skipped: 0, droppedTags: 0, stoppedEarly: true };
  try {
    // Keep tagging until the time budget is spent, waiting out rate limits
    // in place: Vercel refuses long chains of self-calls, so each call
    // should do as much as it can.
    for (;;) {
      const left = TAG_BUDGET_MS - (Date.now() - requestStarted);
      const pass = await enrichPending(db, keys, {
        deadlineMs: Math.max(0, left),
        delayMs: 200,
        backoffMs: 15_000,
      });
      for (const k of ["done", "failed", "skipped", "droppedTags"]) enriched[k] += pass[k] ?? 0;
      if (pass.rateLimited) enriched.rateLimited = true;
      if (!pass.stoppedEarly) {
        enriched.stoppedEarly = false;
        break;
      }
      if (!pass.rateLimited || TAG_BUDGET_MS - (Date.now() - requestStarted) < 20_000) {
        enriched.outOfTime = Boolean(pass.outOfTime || pass.rateLimited);
        break;
      }
    }
  } catch (error) {
    enriched.error = error.message;
  }
  const decision = shouldContinue(enriched, hop, idle);
  const next = decision.next
    ? await startNextHop(environment(), hop + 1, decision.idle)
    : null;
  return { ...enriched, next };
}

async function collect(request) {
  requireCronSecret(request);
  const requestStarted = Date.now();
  // Loaded lazily so read-only deployments never import the collector.
  const [{ createDatabaseClient }, { recoverRunningRuns, startCollection }] =
    await Promise.all([import("./lib/db.js"), import("./lib/collect.js")]);
  const db = createDatabaseClient(environment());
  const recovered = await recoverRunningRuns(db, environment());
  const started = await startCollection(db, environment(), "cron");
  // Tag what was just ingested; a large backlog continues in /api/enrich.
  const enriched = await enrichBatch(0, requestStarted);
  return { recovered, started, enriched };
}

/** Continuation hop: accept at once, tag in the background. */
function continueEnrich(request, response) {
  requireCronSecret(request);
  const hop = Number(request.headers?.["x-enrich-hop"]);
  if (!Number.isInteger(hop) || hop < 1)
    throw new HttpError(400, "Missing or invalid x-enrich-hop");
  const idle = Math.max(0, Number(request.headers?.["x-enrich-idle"]) || 0);
  const requestStarted = Date.now();
  waitUntil(
    // After a rate limit, give the provider time to recover before trying again.
    new Promise((resolve) => setTimeout(resolve, idle ? IDLE_WAIT_MS : 0))
      .then(() => enrichBatch(hop, requestStarted, idle))
      .then((result) =>
        console.log(`Enrich hop ${hop}:`, JSON.stringify(result)),
      )
      .catch((error) => console.error(`Enrich hop ${hop} failed:`, error)),
  );
  sendJson(response, 202, { accepted: true, hop });
}

const routes = {
  "/api/config": async () => ({
    properties: properties.map(({ id, name, bookingUrl }) => ({ id, name, bookingUrl })),
    topics: topics.map((id) => ({ id, label: topicLabels[id] ?? id })),
    thresholds,
    timezone,
    today: today(),
    source: source()?.kind ?? null,
  }),
  "/api/dashboard": (params) => dashboard(params),
  "/api/reviews": (params) => feed(params),
  "/api/health": async () => ({ ok: true, ...(await requireSource().loadHealth()) }),
};

const CACHEABLE = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, { allow: "GET, OPTIONS" });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const forwardedPath = url.searchParams.get("path");
  const pathname = forwardedPath ? `/api/${forwardedPath}` : url.pathname;

  try {
    if (pathname === "/api/enrich") {
      continueEnrich(request, response);
      return;
    }
    if (pathname === "/api/collect") {
      sendJson(response, 200, await collect(request));
      return;
    }
    const route = routes[pathname];
    if (!route) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    const data = await route(url.searchParams);
    sendJson(response, 200, data, pathname === "/api/health" ? "no-store" : CACHEABLE);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error(`API error on ${pathname}:`, error);
    sendJson(response, 500, { error: "Something went wrong loading data. Please try again." });
  }
}
