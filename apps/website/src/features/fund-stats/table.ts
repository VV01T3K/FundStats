import type { FundStat } from "./schema";

export type FundStatSortKey =
  | "symbol"
  | "fundName"
  | "category"
  | "region"
  | "nav"
  | "netAssets"
  | "expenseRatio"
  | "ytdReturn"
  | "oneYearReturn"
  | "threeYearReturn"
  | "risk";

export interface FundStatSort {
  key: FundStatSortKey;
  direction: "asc" | "desc";
}

export const defaultFundStatSort: FundStatSort = {
  key: "ytdReturn",
  direction: "desc",
};

const textSortKeys = new Set<FundStatSortKey>(["symbol", "fundName", "category", "region", "risk"]);

export function filterFundStats(rows: Array<FundStat>, filter: string) {
  const query = filter.trim().toLowerCase();

  if (!query) {
    return rows;
  }

  return rows.filter((fund) =>
    [fund.symbol, fund.fundName, fund.category, fund.region, fund.risk].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
}

export function sortFundStats(rows: Array<FundStat>, sort: FundStatSort) {
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const leftValue = left[sort.key];
    const rightValue = right[sort.key];

    if (textSortKeys.has(sort.key)) {
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    }

    return (Number(leftValue) - Number(rightValue)) * direction;
  });
}

export function nextFundStatSort(current: FundStatSort, key: FundStatSortKey): FundStatSort {
  if (current.key !== key) {
    return { key, direction: "asc" };
  }

  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}
