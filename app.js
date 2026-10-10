/**
 * Shared request handler for local development and Vercel.
 *
 * Exposes:
 *  - GET /api/health
 *  - GET /api/properties
 *  - GET /api/kpis
 *  - GET /api/reviews
 *  - GET /api/runs
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @returns {Promise<void>}
 */

import { createDatabaseClient } from "./lib/db.js";
import { loadEnvironment } from "./lib/env.js";
import {
  getPropertiesSummary,
  getDashboardKpis,
  getReviewsList,
  getScrapeRuns,
} from "./lib/api.js";

let _db = null;
function getDb() {
  if (!_db) {
    _db = createDatabaseClient(loadEnvironment());
  }
  return _db;
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
  });
  response.end(JSON.stringify(data));
}

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const forwardedPath = url.searchParams.get("path");
  const pathname = forwardedPath ? `/api/${forwardedPath}` : url.pathname;

  if (pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "azzurro-review-insights",
      phase: "P3",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    const db = getDb();

    if (pathname === "/api/properties") {
      const data = await getPropertiesSummary(db);
      sendJson(response, 200, data);
      return;
    }

    if (pathname === "/api/kpis") {
      const propertyId = url.searchParams.get("propertyId") || null;
      const days = Number(url.searchParams.get("days") ?? 90);
      const data = await getDashboardKpis(db, { propertyId, days });
      sendJson(response, 200, data);
      return;
    }

    if (pathname === "/api/reviews") {
      const propertyId = url.searchParams.get("propertyId") || null;
      const topic = url.searchParams.get("topic") || null;
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const data = await getReviewsList(db, {
        propertyId,
        topic,
        limit,
        offset,
      });
      sendJson(response, 200, data);
      return;
    }

    if (pathname === "/api/runs") {
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const data = await getScrapeRuns(db, limit);
      sendJson(response, 200, data);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("API error:", error);
    sendJson(response, 500, {
      error: error.message ?? "Internal server error",
    });
  }
}
