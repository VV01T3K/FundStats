import { createFileRoute } from "@tanstack/solid-router";
import { defineServerRoute } from "../../../lib/server-route.ts";

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

function buildElectricShapeUrl(request: Request) {
  const shapeUrl = process.env.ELECTRIC_SHAPE_URL;

  if (!shapeUrl) {
    return null;
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

  return upstreamUrl;
}

export const Route = createFileRoute("/api/electric/fund-stats")(
  defineServerRoute({
    server: {
      handlers: {
        GET: async ({ request }) => {
          const upstreamUrl = buildElectricShapeUrl(request);

          if (!upstreamUrl) {
            return Response.json(
              { error: "ELECTRIC_SHAPE_URL is required to proxy FundStats Electric shapes." },
              { status: 503 },
            );
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
        },
      },
    },
  }),
);
