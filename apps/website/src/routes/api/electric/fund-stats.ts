import { createFileRoute } from "@tanstack/solid-router";
import { createMiddleware, createServerFn } from "@tanstack/solid-start";

const electricTable = process.env.ELECTRIC_TABLE || "fund_stats";
const electricProtocolQueryParams = new Set([
  "live",
  "live_sse",
  "experimental_live_sse",
  "handle",
  "offset",
  "cursor",
  "expired_handle",
  "log",
  "subset__where",
  "subset__limit",
  "subset__offset",
  "subset__order_by",
  "subset__params",
  "subset__where_expr",
  "subset__order_by_expr",
  "cache-buster",
]);

const requestMiddleware = createMiddleware({ type: "request" }).server(({ request, next }) =>
  next({ context: { request } }),
);

export const proxyFundStatsShape = createServerFn({ method: "GET", strict: false })
  .middleware([requestMiddleware])
  .handler(async ({ context: { request } }) => {
    const shapeUrl = process.env.ELECTRIC_SHAPE_URL;

    if (!shapeUrl) {
      return new Response(
        JSON.stringify({
          error: "ELECTRIC_SHAPE_URL is required to proxy FundStats Electric shapes.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    const requestUrl = new URL(request.url);
    const upstreamUrl = new URL(shapeUrl);

    requestUrl.searchParams.forEach((value, key) => {
      if (electricProtocolQueryParams.has(key)) {
        upstreamUrl.searchParams.set(key, value);
      }
    });

    upstreamUrl.searchParams.set("table", electricTable);

    if (process.env.ELECTRIC_SOURCE_ID) {
      upstreamUrl.searchParams.set("source_id", process.env.ELECTRIC_SOURCE_ID);
    }

    if (process.env.ELECTRIC_SECRET) {
      upstreamUrl.searchParams.set("secret", process.env.ELECTRIC_SECRET);
    }

    const response = await fetch(upstreamUrl);
    const headers = new Headers(response.headers);

    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set(
      "Access-Control-Expose-Headers",
      "electric-offset, electric-handle, electric-schema, electric-cursor",
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });

export const Route = createFileRoute("/api/electric/fund-stats")({
  component: () => null,
});
