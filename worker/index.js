/**
 * TCRMS Cloudflare Worker entry point.
 *
 * This intentionally does not pretend authentication or database access exists.
 * Add the Hyperdrive binding and implement real API handlers before operational use.
 */
const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": url.origin,
            "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "access-control-allow-headers": "Content-Type, Authorization",
            "access-control-max-age": "86400",
            "vary": "Origin",
          },
        });
      }

      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        return json({
          service: "tcrms-api-edge",
          status: "worker-ready",
          database: env.HYPERDRIVE ? "binding-present" : "not-configured",
          authentication: "not-implemented",
        });
      }

      return json({
        error: "api_not_configured",
        message: "TCRMS API authentication and database routes have not been implemented yet.",
      }, 503, { "access-control-allow-origin": url.origin, "vary": "Origin" });
    }

    if (!env.ASSETS) {
      return new Response("Static assets binding is missing.", { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },
};
