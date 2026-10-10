/**
 * Clears an AI tagging backlog without a laptop.
 *
 * One Vercel function call can only tag about 25 reviews before its time limit,
 * so after a large collection (a back-fill can add 1,000+ reviews) the cron
 * hands the rest to `/api/enrich`, which tags another batch and hands on again
 * until nothing is pending. Each hop answers 202 at once and works in the
 * background, so hops never wait on each other.
 *
 * A hop that ran out of time before tagging anything (the cron's collection
 * step can use the whole budget) hands on as well.
 * A hop that only met rate limits waits and tries again, up to MAX_IDLE times
 * in a row (per-minute limits clear quickly; a daily limit does not, and then
 * the chain stops). It also stops when nothing is left, a hop made no progress
 * for any other reason (keys failing), or MAX_HOPS is reached. The daily cron
 * picks up anything left.
 */

/** About 2,000 reviews a day at most; a normal day needs none. */
export const MAX_HOPS = 80;

/** Rate-limited hops in a row before giving up until the next cron. */
export const MAX_IDLE = 3;

/** Wait before a hop that follows a rate-limited one, in ms. */
export const IDLE_WAIT_MS = 20_000;

/**
 * @param {{ done?: number; failed?: number; skipped?: number; stoppedEarly?: boolean; rateLimited?: boolean; outOfTime?: boolean; error?: string } | undefined} result
 * @param {number} hop  the hop that produced `result` (0 for the cron itself)
 * @param {number} [idle]  rate-limited hops in a row before this one
 * @returns {{ next: boolean; idle: number }}  idle count to pass to the next hop
 */
export function shouldContinue(result, hop, idle = 0) {
  const stop = { next: false, idle };
  if (!result || result.error || !result.stoppedEarly || hop >= MAX_HOPS)
    return stop;
  const progress =
    (result.done ?? 0) + (result.failed ?? 0) + (result.skipped ?? 0);
  if (progress > 0) return { next: true, idle: 0 };
  if ((result.rateLimited || result.outOfTime) && idle < MAX_IDLE)
    return { next: true, idle: idle + 1 };
  return stop;
}

/**
 * Production URL of this project, set by Vercel. Never taken from the request,
 * so the secret is only ever sent to this project's own domain.
 *
 * @param {Record<string, string|undefined>} env
 */
export function continuationUrl(env) {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/api/enrich` : null;
}

/**
 * Start the next hop. Resolves once the next function has accepted the work.
 *
 * @param {Record<string, string|undefined>} env
 * @param {number} hop  number of the hop to start
 * @param {number} [idle]  rate-limited hops in a row so far
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ started: boolean; hop: number; reason?: string }>}
 */
export async function startNextHop(env, hop, idle = 0, fetchImpl = fetch) {
  const url = continuationUrl(env);
  if (!url)
    return { started: false, hop, reason: "No production URL (not on Vercel)" };
  try {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        "x-enrich-hop": String(hop),
        "x-enrich-idle": String(idle),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 202)
      return { started: false, hop, reason: `HTTP ${response.status}` };
    return { started: true, hop };
  } catch (error) {
    return { started: false, hop, reason: error.message };
  }
}
