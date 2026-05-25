import { createServerFn, createServerOnlyFn } from "@tanstack/solid-start";
import { z } from "zod";

import { fundStatSchema } from "./fund-stats.schema";

const getFundStatsDb = createServerOnlyFn(() => import("./fund-stats.server"));

export const upsertFundStatFn = createServerFn({ method: "POST" })
  .inputValidator(fundStatSchema)
  .handler(async ({ data }) => {
    const { upsertFundStat } = await getFundStatsDb();
    return await upsertFundStat(data);
  });

export const deleteFundStatFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { deleteFundStat } = await getFundStatsDb();
    return await deleteFundStat(data.id);
  });
