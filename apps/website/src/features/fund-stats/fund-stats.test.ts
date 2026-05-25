import { describe, expect, it } from "vite-plus/test";

import { fallbackFundStats, fundStatSchema } from ".";
import { filterFundStats, sortFundStats } from "./table";

describe("fund stats foundation", () => {
  it("keeps fallback fund stats compatible with the public schema", () => {
    expect(fallbackFundStats.length).toBeGreaterThan(0);

    for (const fund of fallbackFundStats) {
      expect(fundStatSchema.safeParse(fund).success).toBe(true);
    }
  });

  it("filters funds by ticker, name, category, region, or risk", () => {
    expect(filterFundStats(fallbackFundStats, "nasdaq")).toHaveLength(1);
    expect(filterFundStats(fallbackFundStats, "emerging")).toHaveLength(1);
    expect(filterFundStats(fallbackFundStats, "moderate").length).toBeGreaterThan(1);
  });

  it("sorts funds without mutating the original rows", () => {
    const originalOrder = fallbackFundStats.map((fund) => fund.symbol);
    const sorted = sortFundStats(fallbackFundStats, {
      key: "expenseRatio",
      direction: "desc",
    });

    expect(sorted[0]?.symbol).toBe("QQQM");
    expect(fallbackFundStats.map((fund) => fund.symbol)).toEqual(originalOrder);
  });
});
