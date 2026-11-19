import type { SnapshotRow, SourceStatus } from "@fundstats/shared/api"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { TriangleAlert } from "lucide-react"
import { useMemo } from "react"

import { latestQuery, sparklinesQuery } from "#/web/api.ts"
import { MarketTable } from "#/web/components/MarketTable.tsx"
import { TableControls } from "#/web/components/TableControls.tsx"
import { formatCompact, formatInteger, formatPercent, formatStamp } from "#/web/format.ts"
import { collectedAt, tableAsOf } from "#/web/freshness.ts"
import { isColumnVisible } from "#/web/prefs.ts"
import { usePrefs } from "#/web/PrefsContext.tsx"
import {
	categoryPatch,
	filterRows,
	type ResolvedView,
	resolveView,
	sortPatch,
	type TableSearch,
	thresholdPatch,
} from "#/web/search.ts"
import { getTable, marketCap, type TableConfig } from "#/web/tables.ts"

/** A source's table. */
export const Route = createFileRoute("/$kind/$source/")({ component: TablePage })

const source$ = getRouteApi("/$kind/$source")

function TablePage() {
	const { source } = source$.useParams()
	const search = source$.useSearch()
	const navigate = source$.useNavigate()
	const { prefs } = usePrefs()
	const { data } = useSuspenseQuery(latestQuery(source))
	const sparklines = useQuery({ ...sparklinesQuery(source), enabled: prefs.sparklines }).data
	const config = getTable(source)
	const view = useMemo(() => resolveView(config, search), [config, search])
	const rows = useMemo(() => filterRows(data.rows, view), [data.rows, view])
	const columns = config.columns.filter((c) => isColumnVisible(prefs, source, c.id))
	const asOf = useMemo(() => tableAsOf(data.rows), [data.rows])

	const update = (patch: Partial<TableSearch>) =>
		navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })

	return (
		<>
			<StaleNotice status={data.source} />
			<MobileSummary config={config} view={view} rows={data.rows} filtered={rows} />
			<TableControls
				config={config}
				view={view}
				rowCount={rows.length}
				onCategory={(value) => update(categoryPatch(value))}
				onThreshold={(value) => update(thresholdPatch(config, value))}
			/>
			<div className="market min-h-0 flex-1 overflow-auto">
				<MarketTable
					config={config}
					rows={rows}
					view={view}
					columns={columns}
					prefs={prefs}
					sparklines={sparklines}
					asOf={asOf}
					onSort={(columnId) => update(sortPatch(config, view, columnId))}
					emptyAction={
						view.q ? (
							<button
								type="button"
								onClick={() => update({ q: undefined })}
								className="border-rule-strong text-ink hover:border-warm hover:text-warm border px-3 py-1.5 text-[11px] tracking-[0.06em] max-sm:min-h-11"
							>
								CLEAR SEARCH “{view.q}”
							</button>
						) : null
					}
				/>
			</div>
		</>
	)
}

/** Says out loud when the table is out of date or empty, and why. */
function StaleNotice({ status }: { readonly status: SourceStatus }) {
	if (!status.stale) return null
	const at = collectedAt(status)
	const failed = status.lastRun?.status === "failed"
	return (
		<div
			role="status"
			className="border-down/40 bg-down/8 flex shrink-0 items-start gap-2.5 border-b px-4 py-2 text-[11px] lg:px-[18px]"
		>
			<TriangleAlert aria-hidden className="text-down mt-px size-3.5 shrink-0" />
			<p className="text-ink">
				{at === null
					? `Nothing collected from ${status.name} yet.`
					: failed
						? `The last update from ${status.name} failed${status.lastRun?.error ? `: ${status.lastRun.error}` : "."}`
						: `Data from ${status.name} is out of date: the next collection is overdue.`}{" "}
				{at ? <span className="text-ink-dim">Showing data collected {formatStamp(at)}.</span> : null}
			</p>
		</div>
	)
}

/**
 * The phone's headline figure (variants/mobile.jsx): total market cap and its 24h change for crypto,
 * the median of the highlighted period for funds.
 */
function MobileSummary({
	config,
	view,
	rows,
	filtered,
}: {
	readonly config: TableConfig
	readonly view: ResolvedView
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly filtered: ReadonlyArray<SnapshotRow>
}) {
	const figure = config.kind === "crypto" ? totalCap(rows) : median(filtered, view)
	if (figure === null) return null
	return (
		<div className="border-rule shrink-0 border-b px-4 py-3 lg:hidden">
			<div className="text-dim flex justify-between gap-3 text-[11px] tracking-[0.12em] uppercase">
				<span>{figure.label}</span>
				<span aria-live="polite">
					<span className="text-ink">{formatInteger(filtered.length)}</span> rows
				</span>
			</div>
			<div className="text-ink mt-0.5 text-[26px] leading-tight">{figure.value}</div>
			{figure.change !== null ? (
				<div className={`text-[11px] ${figure.change >= 0 ? "text-up" : "text-down"}`}>
					{formatPercent(figure.change)} {figure.changeLabel}
				</div>
			) : null}
		</div>
	)
}

/** Total market cap and how much it moved in 24h: Σcap ÷ Σ(cap ÷ (1 + change)) − 1. */
const totalCap = (rows: ReadonlyArray<SnapshotRow>) => {
	let now = 0
	let before = 0
	let counted = 0
	let currency: string | null = null
	for (const row of rows) {
		const cap = marketCap(row)
		const change = row.metrics.change_24h
		if (cap === null || change === undefined) continue
		now += cap
		counted += 1
		before += cap / (1 + change / 100)
		currency ??= row.currency
	}
	if (now === 0) return null
	return {
		label: `Total cap · top ${counted}${currency ? ` (${currency})` : ""}`,
		value: formatCompact(now),
		change: (now / before - 1) * 100,
		changeLabel: "24H",
	}
}

const median = (rows: ReadonlyArray<SnapshotRow>, view: ResolvedView) => {
	const values = rows
		.map((row) => view.highlight.sortValue?.(row))
		.filter((v): v is number => typeof v === "number")
		.sort((a, b) => a - b)
	if (values.length === 0) return null
	const mid = values.length >> 1
	const value = values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2
	return {
		label: `Median ${view.highlight.id.toUpperCase()} · ${values.length} funds`,
		value: formatPercent(value),
		change: null,
		changeLabel: "",
	}
}
