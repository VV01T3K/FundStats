import { createFileRoute } from "@tanstack/solid-router";
import { createServerOnlyFn } from "@tanstack/solid-start";
import { z } from "zod";

import { fundStatSchema } from "../../features/fund-stats/schema";
import { defineServerRoute } from "../../lib/server-route.ts";

const getFundStatsDb = createServerOnlyFn(() => import("../../db/fund-stats.server"));

const deleteFundStatSchema = z.object({
  id: z.string().min(1),
});

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/fund-stats")(
  defineServerRoute({
    server: {
      handlers: {
        GET: async () => {
          const { listFundStats } = await getFundStatsDb();

          return Response.json(await listFundStats());
        },
        POST: async ({ request }) => {
          const parsed = fundStatSchema.safeParse(await readJson(request));

          if (!parsed.success) {
            return Response.json({ error: parsed.error.message }, { status: 400 });
          }

          const { upsertFundStat } = await getFundStatsDb();

          return Response.json(await upsertFundStat(parsed.data));
        },
        PUT: async ({ request }) => {
          const parsed = fundStatSchema.safeParse(await readJson(request));

          if (!parsed.success) {
            return Response.json({ error: parsed.error.message }, { status: 400 });
          }

          const { upsertFundStat } = await getFundStatsDb();

          return Response.json(await upsertFundStat(parsed.data));
        },
        DELETE: async ({ request }) => {
          const parsed = deleteFundStatSchema.safeParse(await readJson(request));

          if (!parsed.success) {
            return Response.json({ error: parsed.error.message }, { status: 400 });
          }

          const { deleteFundStat } = await getFundStatsDb();

          return Response.json(await deleteFundStat(parsed.data.id));
        },
      },
    },
  }),
);
