import { afterEach, describe, expect, it } from "vitest";
import handler, { __setSource } from "../app.js";

function createMockResponse() {
  let statusCode = 200;
  let headers = {};
  let body = "";
  return {
    writeHead(code, h) {
      statusCode = code;
      headers = { ...headers, ...h };
    },
    end(data) {
      body = data ?? "";
    },
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getJson: () => JSON.parse(body),
  };
}

async function call(url, { method = "GET", headers = {} } = {}) {
  const res = createMockResponse();
  await handler({ url, method, headers }, res);
  return res;
}

const fakeSource = {
  kind: "test",
  async loadReviews() {
    return [];
  },
  async loadHealth() {
    return { status: "ok", properties: [] };
  },
};

afterEach(() => __setSource(undefined, undefined));

describe("routing", () => {
  it("returns 404 for unknown routes even without a data source", async () => {
    __setSource(null, {});
    const res = await call("/api/nonexistent");
    expect(res.getStatusCode()).toBe(404);
  });

  it("handles the Vercel rewrite path parameter", async () => {
    __setSource(fakeSource, {});
    const res = await call("/api/index.js?path=health");
    expect(res.getStatusCode()).toBe(200);
    expect(res.getJson().ok).toBe(true);
  });

  it("returns 503 with a clear message when no data source exists", async () => {
    __setSource(null, {});
    const res = await call("/api/dashboard");
    expect(res.getStatusCode()).toBe(503);
    expect(res.getJson().error).toMatch(/No data source/);
  });

  it("rejects bad filters with 400", async () => {
    __setSource(fakeSource, {});
    expect((await call("/api/dashboard?property=nope")).getStatusCode()).toBe(400);
    expect((await call("/api/dashboard?from=2026-13-01")).getStatusCode()).toBe(400);
    expect((await call("/api/dashboard?from=2026-10-10&to=2026-10-01")).getStatusCode()).toBe(400);
    expect((await call("/api/reviews?sort=random")).getStatusCode()).toBe(400);
  });

  it("serves an empty dashboard without errors", async () => {
    __setSource(fakeSource, {});
    const res = await call("/api/dashboard?from=2026-10-05&to=2026-10-10");
    expect(res.getStatusCode()).toBe(200);
    const json = res.getJson();
    expect(json.summary.current.count).toBe(0);
    expect(json.properties).toHaveLength(4);
    expect(json.insights[0].text).toMatch(/No reviews/);
  });
});

describe("protected collect endpoint", () => {
  it("fails closed with 503 when CRON_SECRET is not set", async () => {
    __setSource(fakeSource, {});
    expect((await call("/api/collect")).getStatusCode()).toBe(503);
  });

  it("returns 401 for a wrong secret", async () => {
    __setSource(fakeSource, { CRON_SECRET: "expected-secret" });
    const res = await call("/api/collect", { headers: { authorization: "Bearer wrong" } });
    expect(res.getStatusCode()).toBe(401);
  });
});

describe("OPTIONS", () => {
  it("answers preflight with 204", async () => {
    expect((await call("/api/health", { method: "OPTIONS" })).getStatusCode()).toBe(204);
  });
});
