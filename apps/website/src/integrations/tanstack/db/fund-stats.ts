import { createCollection } from "@tanstack/db";
import { electricCollectionOptions } from "@tanstack/electric-db-collection";

import { deleteFundStatFn, upsertFundStatFn } from "../../../db/fund-stats.fn";
import { fundStatSchema } from "../../../db/fund-stats.schema";
import { proxyFundStatsShape } from "../../../routes/api/electric/fund-stats";
import { appShapeOptions } from "../../electric/collection";

export function createFundStatsCollection(id = "fund-stats") {
  return createCollection(
    electricCollectionOptions({
      id,
      schema: fundStatSchema,
      getKey: (fund) => fund.id,
      shapeOptions: appShapeOptions(new URL(proxyFundStatsShape.url, window.location.origin).href),
      onInsert: async ({ transaction }) =>
        await upsertFundStatFn({ data: transaction.mutations[0].modified }),
      onUpdate: async ({ transaction }) =>
        await upsertFundStatFn({ data: transaction.mutations[0].modified }),
      onDelete: async ({ transaction }) =>
        await deleteFundStatFn({ data: { id: transaction.mutations[0].original.id } }),
    }),
  );
}

let _fundStatsCollection: ReturnType<typeof createFundStatsCollection> | null = null;

export function getFundStatsCollection() {
  return (_fundStatsCollection ??= createFundStatsCollection());
}
