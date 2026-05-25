import { Link, createFileRoute } from "@tanstack/solid-router";
import { createSolidTable, flexRender, getCoreRowModel } from "@tanstack/solid-table";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { createHotkey } from "@tanstack/solid-hotkeys";
import { ilike, or } from "@tanstack/solid-db";
import { For, Show, createMemo, createSignal } from "solid-js";

import { getFundStatsCollection } from "../integrations/tanstack/db/fund-stats";
import { type FundStat } from "../db/fund-stats.schema";
import {
  createCollectionTableColumns,
  createCollectionTableQuery,
} from "../integrations/tanstack/table/collection-table";

export const Route = createFileRoute("/")({
  ssr: false,
  loader: async () => {
    await getFundStatsCollection().preload();
    return null;
  },
  component: Home,
});

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

const fundStatTable = createCollectionTableColumns<FundStat>([
  { key: "symbol", header: "Ticker", width: "92px", class: "font-semibold text-foreground" },
  {
    key: "fundName",
    header: "Fund",
    width: "minmax(260px, 1.8fr)",
    class: "truncate text-foreground",
  },
  { key: "category", header: "Category", width: "minmax(140px, 1fr)", class: "truncate" },
  { key: "region", header: "Region", width: "120px", class: "truncate" },
  {
    key: "nav",
    header: "NAV",
    width: "100px",
    cell: (value) => <span class="tabular-nums">{currency.format(value)}</span>,
  },
  {
    key: "netAssets",
    header: "Assets",
    width: "120px",
    cell: (value) => <span class="tabular-nums">{compactCurrency.format(value)}</span>,
  },
  {
    key: "expenseRatio",
    header: "Expense",
    width: "110px",
    cell: (value) => <span class="tabular-nums">{percent.format(value / 100)}</span>,
  },
  {
    key: "ytdReturn",
    header: "YTD",
    width: "110px",
    cell: (value) => <ReturnCell value={value} />,
  },
  {
    key: "oneYearReturn",
    header: "1Y",
    width: "110px",
    cell: (value) => <ReturnCell value={value} />,
  },
  { key: "risk", header: "Risk", width: "96px", cell: (value) => <RiskBadge risk={value} /> },
]);

function Home() {
  const [filterInput, setFilterInput] = createSignal<HTMLInputElement | null>(null);
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement | null>(null);
  const tableQuery = createCollectionTableQuery<FundStat>({
    collection: getFundStatsCollection(),
    defaultSort: { key: "ytdReturn", direction: "desc" },
    search: (fund, pattern) =>
      or(
        ilike(fund.symbol, pattern),
        ilike(fund.fundName, pattern),
        ilike(fund.category, pattern),
        ilike(fund.region, pattern),
        ilike(fund.risk, pattern),
      ),
  });

  const table = createSolidTable({
    get data() {
      return tableQuery.rows();
    },
    columns: fundStatTable.columns,
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
    tableQuery.setFilter("");
    filterInput()?.blur();
  });

  const totalAssets = createMemo(() =>
    tableQuery.rows().reduce((sum, fund) => sum + fund.netAssets, 0),
  );
  const weightedYtdReturn = createMemo(() => {
    const assets = totalAssets();

    if (!assets) {
      return 0;
    }

    return (
      tableQuery.rows().reduce((sum, fund) => sum + fund.ytdReturn * fund.netAssets, 0) / assets
    );
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
            <Metric label="Funds" value={tableQuery.rows().length.toString()} />
            <Metric label="Assets" value={compactCurrency.format(totalAssets())} />
            <Metric label="Weighted YTD" value={returnPercent.format(weightedYtdReturn() / 100)} />
          </div>
        </header>

        <section class="flex flex-col gap-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              ref={setFilterInput}
              value={tableQuery.filter()}
              onInput={(event) => tableQuery.setFilter(event.currentTarget.value)}
              class="h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
              placeholder="Filter funds"
              type="search"
            />
            <p class="text-sm text-muted-foreground">
              Sorted by {tableQuery.sort().key} {tableQuery.sort().direction}
            </p>
          </div>

          <div class="overflow-hidden rounded-md border border-border bg-card">
            <div class="border-b border-border bg-muted/45 text-xs font-semibold uppercase text-muted-foreground">
              <For each={table.getHeaderGroups()}>
                {(headerGroup) => (
                  <div
                    class="grid min-w-[1280px]"
                    style={{ "grid-template-columns": fundStatTable.columnGrid }}
                  >
                    <For each={headerGroup.headers}>
                      {(header) => {
                        const sortKey = header.column.id;
                        const isSortable = tableQuery.isSortable(sortKey);
                        const active = tableQuery.sort().key === sortKey;

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
                                onClick={() => tableQuery.nextSort(sortKey)}
                              >
                                <span>
                                  {flexRender(header.column.columnDef.header, header.getContext())}
                                </span>
                                <span class="text-[10px] text-muted-foreground">
                                  {active
                                    ? tableQuery.sort().direction === "asc"
                                      ? "ASC"
                                      : "DESC"
                                    : ""}
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
                            "grid-template-columns": fundStatTable.columnGrid,
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
