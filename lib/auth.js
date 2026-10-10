import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-secret check for write and collection endpoints.
 * Fails closed: an unset secret means the endpoint is disabled (503).
 *
 * @param {string|undefined} header Authorization header value
 * @param {string|undefined} secret Expected secret from the environment
 * @returns {{ ok: true } | { ok: false; status: 401|503; error: string }}
 */
export function checkBearer(header, secret) {
  if (!secret) return { ok: false, status: 503, error: "Endpoint not configured" };
  const supplied = String(header ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}
