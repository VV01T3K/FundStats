import { snakeCamelMapper } from "@electric-sql/client";
import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { electricCollectionOptions } from "@tanstack/electric-db-collection";

import { fallbackFundStats } from "./data";
import { fundStatSchema, type FundStat } from "./schema";

async function persistFundStat(method: "POST" | "PUT", fund: FundStat) {
  const response = await fetch("/api/fund-stats", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fund),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { txid: number };
}

async function removeFundStat(id: string) {
  const response = await fetch("/api/fund-stats", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { txid: number };
}

export const fundStatsCollection = createCollection(
  localOnlyCollectionOptions({
    id: "fund-stats-fallback",
    schema: fundStatSchema,
    getKey: (fund: FundStat) => fund.id,
    initialData: fallbackFundStats,
  }),
);

export function createElectricFundStatsCollection(
  shapeUrl = "/api/electric/fund-stats",
  id = "fund-stats-electric",
) {
  return createCollection(
    electricCollectionOptions({
      id,
      schema: fundStatSchema,
      getKey: (fund) => fund.id,
      shapeOptions: {
        url: shapeUrl,
        columnMapper: snakeCamelMapper(),
      },
      onInsert: async ({ transaction }) =>
        await persistFundStat("POST", transaction.mutations[0].modified),
      onUpdate: async ({ transaction }) =>
        await persistFundStat("PUT", transaction.mutations[0].modified),
      onDelete: async ({ transaction }) =>
        await removeFundStat(transaction.mutations[0].original.id),
    }),
  );
}
