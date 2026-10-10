/**
 * Shared request handler for local development and Vercel.
 *
 * Keeping routing here makes the production function and local server exercise
 * the same behaviour from the first deployment spike onward.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @returns {void}
 */
export default function handler(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const forwardedPath = url.searchParams.get("path");
  const pathname = forwardedPath ? `/api/${forwardedPath}` : url.pathname;

  if (pathname === "/api/health") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({
        ok: true,
        service: "azzurro-review-insights",
        phase: "P0",
      }),
    );
    return;
  }

  response.writeHead(404, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ error: "Not found" }));
}
