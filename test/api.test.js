import { describe, it, expect } from "vitest";
import handler from "../app.js";

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
    getBody: () => body,
    getJson: () => JSON.parse(body),
  };
}

describe("GET /api/health", () => {
  it("returns ok=true and phase=P3", async () => {
    const req = { url: "/api/health", method: "GET" };
    const res = createMockResponse();

    await handler(req, res);

    expect(res.getStatusCode()).toBe(200);
    const json = res.getJson();
    expect(json.ok).toBe(true);
    expect(json.phase).toBe("P3");
  });

  it("handles forwarded path parameter from Vercel rewrite", async () => {
    const req = { url: "/api/index.js?path=health", method: "GET" };
    const res = createMockResponse();

    await handler(req, res);

    expect(res.getStatusCode()).toBe(200);
    expect(res.getJson().ok).toBe(true);
  });
});

describe("GET /api/unknown", () => {
  it("returns 404 for unknown route", async () => {
    const req = { url: "/api/nonexistent", method: "GET" };
    const res = createMockResponse();

    await handler(req, res);

    expect(res.getStatusCode()).toBe(404);
    expect(res.getJson()).toEqual({ error: "Not found" });
  });
});

describe("OPTIONS /api/*", () => {
  it("handles CORS preflight", async () => {
    const req = { url: "/api/health", method: "OPTIONS" };
    const res = createMockResponse();

    await handler(req, res);

    expect(res.getStatusCode()).toBe(204);
  });
});
