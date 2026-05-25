import { Link, createFileRoute } from "@tanstack/solid-router";
import {
  createColumnHelper,
  createSolidTable,
  flexRender,
  getCoreRowModel,
} from "@tanstack/solid-table";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { createHotkey } from "@tanstack/solid-hotkeys";
import { useLiveQuery } from "@tanstack/solid-db";
import { For, Show, createMemo, createSignal } from "solid-js";

import { getFundStatsCollection } from "../integrations/tanstack/db/fund-stats";
import { type FundStat } from "../db/fund-stats.schema";
import {
  defaultFundStatSort,
  filterFundStats,
  nextFundStatSort,
  sortFundStats,
  type FundStatSortKey,
} from "../tables/fund-stats";

export const Route = createFileRoute("/")({
  ssr: false,
  loader: async () => {
    await getFundStatsCollection().preload();
    return null;
  },
  component: Home,
});

const columnHelper = createColumnHelper<FundStat>();
const columnGrid =
  "92px minmax(260px, 1.8fr) minmax(140px, 1fr) 120px 100px 120px 110px 110px 110px 96px";
const sortableColumns = new Set<FundStatSortKey>([
  "symbol",
  "fundName",
  "category",
  "region",
  "nav",
  "netAssets",
  "expenseRatio",
  "ytdReturn",
  "oneYearReturn",
  "threeYearReturn",
  "risk",
]);

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const returnPercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const columns = [
  columnHelper.accessor("symbol", {
    header: "Ticker",
    cell: (info) => <span class="font-semibold text-foreground">{info.getValue()}</span>,
  }),
  columnHelper.accessor("fundName", {
    header: "Fund",
    cell: (info) => <span class="truncate text-foreground">{info.getValue()}</span>,
  }),
  columnHelper.accessor("category", {
    header: "Category",
    cell: (info) => <span class="truncate">{info.getValue()}</span>,
  }),
  columnHelper.accessor("region", {
    header: "Region",
    cell: (info) => <span class="truncate">{info.getValue()}</span>,
  }),
  columnHelper.accessor("nav", {
    header: "NAV",
    cell: (info) => <span class="tabular-nums">{currency.format(info.getValue())}</span>,
  }),
  columnHelper.accessor("netAssets", {
    header: "Assets",
    cell: (info) => <span class="tabular-nums">{compactCurrency.format(info.getValue())}</span>,
  }),
  columnHelper.accessor("expenseRatio", {
    header: "Expense",
    cell: (info) => <span class="tabular-nums">{percent.format(info.getValue() / 100)}</span>,
  }),
  columnHelper.accessor("ytdReturn", {
    header: "YTD",
    cell: (info) => <ReturnCell value={info.getValue()} />,
  }),
  columnHelper.accessor("oneYearReturn", {
    header: "1Y",
    cell: (info) => <ReturnCell value={info.getValue()} />,
  }),
  columnHelper.accessor("risk", {
    header: "Risk",
    cell: (info) => <RiskBadge risk={info.getValue()} />,
  }),
];

function Home() {
  const [filterInput, setFilterInput] = createSignal<HTMLInputElement | null>(null);
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement | null>(null);
  const [filter, setFilter] = createSignal("");
  const [sort, setSort] = createSignal(defaultFundStatSort);
  const fundStatsQuery = useLiveQuery((query) => query.from({ fund: getFundStatsCollection() }));

  const rows = createMemo(() => sortFundStats(filterFundStats(fundStatsQuery(), filter()), sort()));

  const table = createSolidTable({
    get data() {
      return rows();
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return table.getRowModel().rows.length;
    },
    getScrollElement: () => scrollElement(),
    estimateSize: () => 48,
    overscan: 6,
  });

  createHotkey(
    "/",
    (event) => {
      event.preventDefault();
      filterInput()?.focus();
    },
    { preventDefault: true },
  );

  createHotkey("Escape", () => {
    setFilter("");
    filterInput()?.blur();
  });

  const totalAssets = createMemo(() => rows().reduce((sum, fund) => sum + fund.netAssets, 0));
  const weightedYtdReturn = createMemo(() => {
    const assets = totalAssets();

    if (!assets) {
      return 0;
    }

    return rows().reduce((sum, fund) => sum + fund.ytdReturn * fund.netAssets, 0) / assets;
  });

  return (
    <main class="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8">
      <div class="mx-auto flex max-w-7xl flex-col gap-5">
        <header class="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div class="flex items-start gap-4">
            <div>
              <p class="text-sm font-medium text-muted-foreground">FundStats</p>
              <h1 class="mt-1 text-3xl font-semibold tracking-normal">Fund universe</h1>
            </div>
            <Link
              to="/funds/new"
              class="ml-auto inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted lg:ml-0"
            >
              + Add fund
            </Link>
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <Metric label="Funds" value={rows().length.toString()} />
            <Metric label="Assets" value={compactCurrency.format(totalAssets())} />
            <Metric label="Weighted YTD" value={returnPercent.format(weightedYtdReturn() / 100)} />
          </div>
        </header>

        <section class="flex flex-col gap-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              ref={setFilterInput}
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
              class="h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              placeholder="Filter funds"
              type="search"
            />
            <p class="text-sm text-muted-foreground">
              Sorted by {sort().key} {sort().direction}
            </p>
          </div>

          <div class="overflow-hidden rounded-md border border-border bg-card">
            <div class="border-b border-border bg-muted/45 text-xs font-semibold uppercase text-muted-foreground">
              <For each={table.getHeaderGroups()}>
                {(headerGroup) => (
                  <div class="grid min-w-[1280px]" style={{ "grid-template-columns": columnGrid }}>
                    <For each={headerGroup.headers}>
                      {(header) => {
                        const sortKey = header.column.id as FundStatSortKey;
                        const isSortable = sortableColumns.has(sortKey);
                        const active = sort().key === sortKey;

                        return (
                          <div class="flex h-11 items-center border-r border-border/70 px-3 last:border-r-0">
                            <Show
                              when={isSortable}
                              fallback={flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                            >
                              <button
                                class="flex w-full items-center justify-between gap-2 text-left"
                                type="button"
                                onClick={() =>
                                  setSort((current) => nextFundStatSort(current, sortKey))
                                }
                              >
                                <span>
                                  {flexRender(header.column.columnDef.header, header.getContext())}
                                </span>
                                <span class="text-[10px] text-muted-foreground">
                                  {active ? (sort().direction === "asc" ? "ASC" : "DESC") : ""}
                                </span>
                              </button>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </div>

            <div ref={setScrollElement} class="h-[430px] overflow-auto">
              <Show
                when={table.getRowModel().rows.length > 0}
                fallback={<div class="p-6 text-sm text-muted-foreground">No matching funds.</div>}
              >
                <div
                  class="relative min-w-[1280px]"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  <For each={rowVirtualizer.getVirtualItems()}>
                    {(virtualRow) => {
                      const row = table.getRowModel().rows[virtualRow.index];

                      return (
                        <div
                          ref={rowVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          class="absolute left-0 grid w-full border-b border-border/70 text-sm text-muted-foreground"
                          style={{
                            "grid-template-columns": columnGrid,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <For each={row.getVisibleCells()}>
                            {(cell) => (
                              <div class="flex h-12 min-w-0 items-center border-r border-border/50 px-3 last:border-r-0">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            )}
                          </For>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div class="min-w-32 rounded-md border border-border bg-card px-3 py-2">
      <p class="text-xs font-medium text-muted-foreground">{props.label}</p>
      <p class="mt-1 text-lg font-semibold tabular-nums">{props.value}</p>
    </div>
  );
}

function ReturnCell(props: { value: number }) {
  const positive = () => props.value >= 0;

  return (
    <span
      class={
        positive()
          ? "font-medium tabular-nums text-emerald-700"
          : "font-medium tabular-nums text-red-700"
      }
    >
      {returnPercent.format(props.value / 100)}
    </span>
  );
}

function RiskBadge(props: { risk: FundStat["risk"] }) {
  return (
    <span class="rounded-sm border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground">
      {props.risk}
    </span>
  );
}
