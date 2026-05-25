import { createFileRoute } from "@tanstack/solid-router";
import {
  createColumnHelper,
  createSolidTable,
  flexRender,
  getCoreRowModel,
} from "@tanstack/solid-table";
import type { Table } from "@tanstack/solid-table";
import { For, createSignal } from "solid-js";

import { fallbackFundStats, type FundStat } from "../features/fund-stats";

export const Route = createFileRoute("/skeleton")({
  ssr: false,
  component: Home,
});

// ── Color tokens ──────────────────────────────────────────────────────────────
const term = {
  bg: "#0a0b0c",
  panel: "#0e1012",
  rule: "#1c1f23",
  ruleStrong: "#2a3038",
  ink: "#d9dde2",
  inkDim: "#a8aeb6",
  dim: "#6a727b",
  warm: "#f7b955",
  up: "#2ee07a",
  down: "#ff5a5f",
  mono: "ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', Menlo, monospace",
};

// ── Sources ───────────────────────────────────────────────────────────────────
const SOURCES = [
  { id: "electric", label: "Electric DB", tag: "Real-time ETF universe", status: "live" },
  { id: "mbank", label: "mBank · Funds", tag: "Polish investment funds", status: "cached" },
  { id: "yahoo", label: "Yahoo Finance", tag: "ETFs · stocks · classic markets", status: "live" },
];

// ── Sortable column ids ───────────────────────────────────────────────────────
const SORTABLE = new Set(["nav", "netAssets", "expenseRatio", "ytdReturn", "oneYearReturn"]);

// ── Column grid ───────────────────────────────────────────────────────────────
const columnGrid =
  "44px 92px minmax(260px, 2fr) minmax(140px, 1fr) 130px 100px 120px 110px 100px 100px 100px";

// ── Formatters ────────────────────────────────────────────────────────────────
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const retPct = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// ── Static placeholder data ───────────────────────────────────────────────────
const staticRows = [...fallbackFundStats].sort((a, b) => b.ytdReturn - a.ytdReturn);

// ── Column definitions ────────────────────────────────────────────────────────
const columnHelper = createColumnHelper<FundStat>();

const columns = [
  columnHelper.display({
    id: "_rank",
    header: "#",
    cell: (info) => (
      <span style={{ color: term.dim, "font-variant-numeric": "tabular-nums" }}>
        {String(info.row.index + 1).padStart(2, "0")}
      </span>
    ),
  }),
  columnHelper.accessor("symbol", {
    header: "TICKER",
    cell: (info) => (
      <span style={{ "font-weight": "600", color: term.ink }}>{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor("fundName", {
    header: "FUND",
    cell: (info) => (
      <span
        style={{
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          display: "block",
          color: term.ink,
        }}
      >
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor("category", {
    header: "CATEGORY",
    cell: (info) => (
      <span
        style={{
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          display: "block",
          color: term.inkDim,
        }}
      >
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor("region", {
    header: "REGION",
    cell: (info) => (
      <span
        style={{
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          display: "block",
          color: term.inkDim,
        }}
      >
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor("nav", {
    header: "NAV",
    cell: (info) => (
      <span style={{ "font-variant-numeric": "tabular-nums", color: term.ink }}>
        {usd.format(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor("netAssets", {
    header: "ASSETS",
    cell: (info) => (
      <span style={{ "font-variant-numeric": "tabular-nums", color: term.inkDim }}>
        {usdCompact.format(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor("expenseRatio", {
    header: "EXPENSE",
    cell: (info) => (
      <span style={{ "font-variant-numeric": "tabular-nums", color: term.inkDim }}>
        {pct.format(info.getValue() / 100)}
      </span>
    ),
  }),
  columnHelper.accessor("ytdReturn", {
    header: "YTD %",
    cell: (info) => {
      const v = info.getValue();
      return (
        <span
          style={{
            "font-variant-numeric": "tabular-nums",
            "font-weight": "600",
            color: v >= 0 ? term.up : term.down,
          }}
        >
          {(v >= 0 ? "+" : "") + retPct.format(v / 100)}
        </span>
      );
    },
  }),
  columnHelper.accessor("oneYearReturn", {
    header: "1Y %",
    cell: (info) => {
      const v = info.getValue();
      return (
        <span
          style={{
            "font-variant-numeric": "tabular-nums",
            "font-weight": "600",
            color: v >= 0 ? term.up : term.down,
          }}
        >
          {(v >= 0 ? "+" : "") + retPct.format(v / 100)}
        </span>
      );
    },
  }),
  columnHelper.accessor("risk", {
    header: "RISK",
    cell: (info) => (
      <span
        style={{
          padding: "1px 7px",
          border: `1px solid ${term.ruleStrong}`,
          color: term.warm,
          "font-size": "10px",
          "letter-spacing": "0.06em",
          "text-transform": "uppercase",
          "white-space": "nowrap",
        }}
      >
        {info.getValue()}
      </span>
    ),
  }),
];

// ── DS Monogram glyph (square/stencil variant) ────────────────────────────────
function DSGlyphMono(props: { size?: number; color?: string; accent?: string }) {
  const size = () => props.size ?? 24;
  const color = () => props.color ?? "currentColor";
  const accent = () => props.accent ?? color();
  return (
    <svg viewBox="0 0 64 64" width={size() * 1.05} height={size()} style={{ display: "block" }}>
      <defs>
        <mask id="dsm-mask">
          <rect width="64" height="64" fill="white" />
          <rect x="36" y="29" width="16" height="7" fill="black" />
        </mask>
      </defs>
      <g mask="url(#dsm-mask)">
        <path
          d="M 8 6 L 30 6 L 50 18 L 50 46 L 30 58 L 8 58 Z M 16 14 L 16 50 L 28 50 L 42 42 L 42 22 L 28 14 Z"
          fill={color()}
        />
      </g>
      <path
        d="M 50 16 L 36 16 L 22 26 L 36 34 L 50 34 L 50 46 L 32 50 L 22 46"
        fill="none"
        stroke={accent()}
        stroke-width="6"
        stroke-linejoin="miter"
        stroke-linecap="square"
      />
    </svg>
  );
}

// ── Wordmark ──────────────────────────────────────────────────────────────────
function Wordmark(props: { size?: number }) {
  const size = () => props.size ?? 22;
  const textStyle = () => ({
    color: term.ink,
    "font-weight": "700",
    "font-family": term.mono,
    "font-size": `${size()}px`,
    "line-height": "1",
    "letter-spacing": "-0.01em",
  });
  return (
    <span
      aria-label="FunDStats"
      style={{ display: "inline-flex", "align-items": "center", gap: `${size() * 0.04}px` }}
    >
      <span style={textStyle()}>Fun</span>
      <DSGlyphMono size={size()} color={term.ink} accent={term.warm} />
      <span style={textStyle()}>tats</span>
    </span>
  );
}

// ── App header ────────────────────────────────────────────────────────────────
function TerminalHeader(props: { search: string; onSearch: (v: string) => void }) {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr auto 1fr",
        "align-items": "center",
        gap: "14px",
        padding: "10px 18px",
        "border-bottom": `1px solid ${term.rule}`,
        background: term.panel,
        "font-family": term.mono,
        "font-size": "11px",
        color: term.dim,
        "flex-shrink": "0",
      }}
    >
      {/* LEFT: menu + wordmark */}
      <div style={{ display: "flex", "align-items": "center", gap: "14px" }}>
        <button
          aria-label="Open menu"
          style={{
            width: "30px",
            height: "24px",
            padding: "0",
            background: "transparent",
            border: `1px solid ${term.ruleStrong}`,
            color: term.warm,
            cursor: "pointer",
            display: "grid",
            "place-items": "center",
          }}
        >
          <span style={{ display: "inline-flex", "flex-direction": "column", gap: "3px" }}>
            <span
              style={{
                display: "block",
                width: "12px",
                height: "1.5px",
                background: "currentColor",
              }}
            />
            <span
              style={{
                display: "block",
                width: "12px",
                height: "1.5px",
                background: "currentColor",
              }}
            />
            <span
              style={{
                display: "block",
                width: "12px",
                height: "1.5px",
                background: "currentColor",
              }}
            />
          </span>
        </button>
        <Wordmark size={20} />
      </div>

      {/* CENTER: search */}
      <div style={{ position: "relative", width: "480px", "max-width": "100%" }}>
        <input
          type="search"
          value={props.search}
          onInput={(e) => props.onSearch(e.currentTarget.value)}
          placeholder="Search funds, tickers — e.g. VTI, BND, Vanguard"
          style={{
            width: "100%",
            padding: "8px 14px 8px 36px",
            background: term.bg,
            color: term.ink,
            border: `1px solid ${term.ruleStrong}`,
            "font-family": term.mono,
            "font-size": "12px",
            outline: "none",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            color: term.dim,
            "font-size": "14px",
            "pointer-events": "none",
          }}
        >
          ⌕
        </span>
        <kbd
          style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            color: term.dim,
            "font-family": term.mono,
            "font-size": "10px",
            border: `1px solid ${term.rule}`,
            padding: "1px 5px",
            background: "transparent",
          }}
        >
          /
        </kbd>
      </div>

      {/* RIGHT: live + account */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "14px",
          "justify-content": "flex-end",
        }}
      >
        <div
          style={{ display: "inline-flex", "align-items": "center", gap: "6px", color: term.up }}
        >
          <span
            style={{ width: "6px", height: "6px", background: term.up, display: "inline-block" }}
          />
          <span>LIVE</span>
          <span style={{ color: term.dim, "margin-left": "4px" }}>May 25, 2026 · 12:00 UTC</span>
        </div>
        <div style={{ width: "1px", height: "18px", background: term.ruleStrong }} />
        <button
          style={{
            background: "transparent",
            border: `1px solid ${term.ruleStrong}`,
            color: term.inkDim,
            "font-family": term.mono,
            "font-size": "11px",
            padding: "4px 10px",
            cursor: "pointer",
            "letter-spacing": "0.06em",
          }}
        >
          ACCOUNT
        </button>
      </div>
    </div>
  );
}

// ── Source tabs ────────────────────────────────────────────────────────────────
function TerminalSourceTabs(props: { source: string; onSource: (id: string) => void }) {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "stretch",
        "border-bottom": `1px solid ${term.ruleStrong}`,
        background: term.bg,
        "flex-shrink": "0",
      }}
    >
      <For each={SOURCES}>
        {(tab) => {
          const active = () => props.source === tab.id;
          return (
            <button
              onClick={() => props.onSource(tab.id)}
              style={{
                flex: "1",
                padding: "13px 22px",
                background: active() ? term.panel : "transparent",
                border: "none",
                "border-right": `1px solid ${term.rule}`,
                "border-bottom": active() ? `3px solid ${term.warm}` : "3px solid transparent",
                color: active() ? term.ink : term.dim,
                cursor: "pointer",
                "text-align": "left",
                "font-family": term.mono,
                transition: "background 120ms ease",
                "min-width": "0",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    background: active() ? term.warm : term.rule,
                    display: "inline-block",
                    "flex-shrink": "0",
                  }}
                />
                <span
                  style={{
                    "font-size": "13px",
                    "font-weight": active() ? "700" : "500",
                    "letter-spacing": "0.04em",
                    color: active() ? term.ink : term.inkDim,
                    "white-space": "nowrap",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                  }}
                >
                  {tab.label}
                </span>
                {active() && (
                  <span
                    style={{
                      display: "inline-flex",
                      "align-items": "center",
                      gap: "4px",
                      "margin-left": "4px",
                      padding: "1px 7px",
                      background: term.bg,
                      color: tab.status === "cached" ? term.warm : term.up,
                      border: `1px solid ${term.ruleStrong}`,
                      "font-size": "9px",
                      "letter-spacing": "0.1em",
                      "font-weight": "700",
                      "flex-shrink": "0",
                    }}
                  >
                    <span
                      style={{
                        width: "4px",
                        height: "4px",
                        background: "currentColor",
                        display: "inline-block",
                      }}
                    />
                    {tab.status === "cached" ? "CACHED" : "LIVE"}
                  </span>
                )}
              </div>
              <div
                style={{
                  "margin-top": "4px",
                  "font-size": "11px",
                  color: term.dim,
                  "white-space": "nowrap",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                }}
              >
                {tab.tag}
              </div>
            </button>
          );
        }}
      </For>
      <button
        title="Manage sources"
        style={{
          padding: "0 18px",
          background: "transparent",
          border: "none",
          "border-bottom": "3px solid transparent",
          color: term.dim,
          cursor: "pointer",
          "font-family": term.mono,
          display: "inline-flex",
          "align-items": "center",
          gap: "6px",
        }}
      >
        <span
          style={{
            width: "26px",
            height: "26px",
            border: `1px dashed ${term.ruleStrong}`,
            display: "grid",
            "place-items": "center",
            color: term.dim,
            "font-size": "16px",
            "line-height": "1",
          }}
        >
          +
        </span>
        <span style={{ "font-size": "11px", "letter-spacing": "0.08em" }}>MANAGE</span>
      </button>
    </div>
  );
}

// ── Table controls ─────────────────────────────────────────────────────────────
function TerminalTableControls(props: { rowCount: number }) {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        padding: "8px 18px",
        "border-bottom": `1px solid ${term.rule}`,
        background: term.bg,
        "flex-shrink": "0",
      }}
    >
      <span style={{ color: term.dim, "font-family": term.mono, "font-size": "11px" }}>
        Click any column header to sort. Data as of 2026-05-22.
      </span>
      <div style={{ flex: "1" }} />
      <span
        style={{
          color: term.dim,
          "font-family": term.mono,
          "font-size": "11px",
          padding: "4px 10px",
          border: `1px solid ${term.rule}`,
        }}
      >
        <span style={{ color: term.ink, "font-weight": "600" }}>{props.rowCount}</span> rows
      </span>
      <button
        style={{
          padding: "4px 12px",
          background: "transparent",
          color: term.dim,
          border: `1px solid ${term.ruleStrong}`,
          "font-family": term.mono,
          "font-size": "11px",
          "letter-spacing": "0.06em",
          cursor: "pointer",
        }}
      >
        COLUMNS ▾
      </button>
    </div>
  );
}

// ── Table ──────────────────────────────────────────────────────────────────────
function TerminalTable(props: {
  table: Table<FundStat>;
  sortKey: string;
  onSort: (key: string) => void;
}) {
  return (
    <div
      style={{
        "font-family": term.mono,
        "font-size": "12px",
        flex: "1",
        "min-width": "0",
        "min-height": "0",
        display: "flex",
        "flex-direction": "column",
        "overflow-x": "auto",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": columnGrid,
          "min-width": "1300px",
          padding: "7px 18px",
          "border-bottom": `1px solid ${term.ruleStrong}`,
          color: term.dim,
          "font-size": "10px",
          "text-transform": "uppercase",
          "letter-spacing": "0.1em",
          background: term.panel,
          "flex-shrink": "0",
        }}
      >
        <For each={props.table.getHeaderGroups()}>
          {(group) => (
            <For each={group.headers}>
              {(header) => {
                const active = () => props.sortKey === header.column.id;
                const sortable = SORTABLE.has(header.column.id);
                return (
                  <div
                    onClick={() => sortable && props.onSort(header.column.id)}
                    style={{
                      "padding-right": "10px",
                      "font-variant-numeric": "tabular-nums",
                      cursor: sortable ? "pointer" : "default",
                      color: active() ? term.warm : term.dim,
                      "user-select": "none",
                      display: "flex",
                      "align-items": "center",
                      gap: "4px",
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {active() && <span style={{ color: term.warm, "font-size": "10px" }}>↓</span>}
                  </div>
                );
              }}
            </For>
          )}
        </For>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: "1", "min-height": "0", "overflow-y": "auto" }}>
        <For each={props.table.getRowModel().rows}>
          {(row) => (
            <div
              style={{
                display: "grid",
                "grid-template-columns": columnGrid,
                "min-width": "1300px",
                padding: "8px 18px",
                "border-bottom": `1px solid ${term.rule}`,
                "border-left": "2px solid transparent",
                "align-items": "center",
                "font-variant-numeric": "tabular-nums",
              }}
            >
              <For each={row.getVisibleCells()}>
                {(cell) => (
                  <div
                    style={{
                      "padding-right": "10px",
                      "min-width": "0",
                      display: "flex",
                      "align-items": "center",
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// ── Footer ─────────────────────────────────────────────────────────────────────
function TerminalFooter() {
  const btn = (label: string, primary = false, disabled = false) => (
    <button
      disabled={disabled}
      style={{
        padding: "4px 12px",
        background: "transparent",
        border: `1px solid ${disabled ? term.rule : term.ruleStrong}`,
        color: disabled ? term.dim : primary ? term.warm : term.ink,
        "font-family": term.mono,
        "font-size": "11px",
        "letter-spacing": "0.08em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? "0.5" : "1",
        display: "inline-flex",
        "align-items": "center",
        gap: "6px",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        "border-top": `1px solid ${term.rule}`,
        background: term.panel,
        padding: "7px 18px",
        "font-family": term.mono,
        "font-size": "11px",
        color: term.dim,
        display: "flex",
        gap: "10px",
        "align-items": "center",
        "flex-wrap": "wrap",
        "flex-shrink": "0",
      }}
    >
      <span style={{ color: term.dim, "font-size": "10px", "letter-spacing": "0.1em" }}>
        JUMP TO →
      </span>
      {btn("↟ TOP")}
      {btn("↔ MIDDLE")}
      {btn("↡ BOTTOM")}
      {btn("◐ SIGN FLIP · YTD %", true, true)}
      <span style={{ color: term.dim, "font-size": "10px", "margin-left": "6px" }}>
        (jumps to where the sorted column crosses zero)
      </span>
      <div style={{ flex: "1" }} />
      <span style={{ "font-size": "10px", "letter-spacing": "0.06em", color: term.dim }}>
        FunDStats · Electric DB · v2-rewrite
      </span>
    </div>
  );
}

// ── Home ───────────────────────────────────────────────────────────────────────
function Home() {
  // Seams for wiring real logic later:
  const [source, setSource] = createSignal("electric"); // → switch data source
  const [search, setSearch] = createSignal(""); // → drive filterFundStats()
  const [sortKey, setSortKey] = createSignal("ytdReturn"); // → drive sortFundStats()

  const table = createSolidTable({
    get data() {
      return staticRows;
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div
      style={{
        height: "100dvh",
        overflow: "hidden",
        display: "flex",
        "flex-direction": "column",
        background: term.bg,
        color: term.ink,
      }}
    >
      <TerminalHeader search={search()} onSearch={setSearch} />
      <TerminalSourceTabs source={source()} onSource={setSource} />
      <TerminalTableControls rowCount={staticRows.length} />
      <div
        style={{
          flex: "1",
          "min-height": "0",
          overflow: "hidden",
          display: "flex",
          "flex-direction": "column",
        }}
      >
        <TerminalTable table={table} sortKey={sortKey()} onSort={setSortKey} />
      </div>
      <TerminalFooter />
    </div>
  );
}
