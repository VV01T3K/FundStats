import { createFileRoute } from "@tanstack/solid-router";
import { createMiddleware, createServerFn } from "@tanstack/solid-start";
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client";

const electricTable = process.env.ELECTRIC_TABLE || "fund_stats";
const defaultDevShapeUrl = "http://127.0.0.1:5133/v1/shape";
const electricProtocolQueryParams = new Set(ELECTRIC_PROTOCOL_QUERY_PARAMS);

function getElectricShapeUrl() {
  if (process.env.ELECTRIC_SHAPE_URL) {
    return process.env.ELECTRIC_SHAPE_URL;
  }

  if (process.env.NODE_ENV !== "production") {
    return defaultDevShapeUrl;
  }

  return null;
}

const requestMiddleware = createMiddleware({ type: "request" }).server(({ request, next }) =>
  next({ context: { request } }),
);

export const proxyFundStatsShape = createServerFn({ method: "GET", strict: false })
  .middleware([requestMiddleware])
  .handler(async ({ context: { request } }) => {
    const shapeUrl = getElectricShapeUrl();

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
