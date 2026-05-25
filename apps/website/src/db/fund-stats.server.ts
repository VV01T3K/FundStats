import { eq, sql } from "drizzle-orm";

import type { FundStat } from "../features/fund-stats/schema";
import { db } from "./client.server";
import { fundStats, type NewFundStatRow } from "./schema";

type TxidResult = {
  txid: string;
};

function toFundStatRow(fund: FundStat): NewFundStatRow {
  return {
    id: fund.id,
    symbol: fund.symbol,
    fundName: fund.fundName,
    category: fund.category,
    region: fund.region,
    nav: fund.nav,
    netAssets: fund.netAssets,
    expenseRatio: fund.expenseRatio,
    ytdReturn: fund.ytdReturn,
    oneYearReturn: fund.oneYearReturn,
    threeYearReturn: fund.threeYearReturn,
    risk: fund.risk,
    asOf: fund.asOf,
  };
}

async function currentTransactionId(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const [row] = await tx.execute<TxidResult>(sql`SELECT pg_current_xact_id()::xid::text AS txid`);

  return Number(row.txid);
}

export async function listFundStats() {
  return await db.select().from(fundStats).orderBy(fundStats.symbol);
}

export async function upsertFundStat(fund: FundStat) {
  return await db.transaction(async (tx) => {
    const row = toFundStatRow(fund);

    await tx
      .insert(fundStats)
      .values(row)
      .onConflictDoUpdate({
        target: fundStats.id,
        set: {
          symbol: row.symbol,
          fundName: row.fundName,
          category: row.category,
          region: row.region,
          nav: row.nav,
          netAssets: row.netAssets,
          expenseRatio: row.expenseRatio,
          ytdReturn: row.ytdReturn,
          oneYearReturn: row.oneYearReturn,
          threeYearReturn: row.threeYearReturn,
          risk: row.risk,
          asOf: row.asOf,
          updatedAt: sql`now()`,
        },
      });

    return { id: fund.id, txid: await currentTransactionId(tx) };
  });
}

export async function deleteFundStat(id: string) {
  return await db.transaction(async (tx) => {
    await tx.delete(fundStats).where(eq(fundStats.id, id));

    return { id, txid: await currentTransactionId(tx) };
  });
}
