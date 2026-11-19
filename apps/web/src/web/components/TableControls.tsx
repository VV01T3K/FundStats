import { Popover } from "@base-ui/react/popover"
import type { SnapshotRow } from "@fundstats/shared/api"
import { Settings2, X } from "lucide-react"

import { cn } from "#/lib/utils"

import { formatInteger } from "../format.ts"
import { isColumnVisible, withAllColumns, withColumn } from "../prefs.ts"
import { usePrefs } from "../PrefsContext.tsx"
import {
	clearFiltersPatch,
	facetColumns,
	facetPatch,
	hasFilters,
	highlightPatch,
	minCapPatch,
	type ResolvedView,
	type TableSearch,
} from "../search.ts"
import { type Column, MARKET_CAP_FLOORS, type TableConfig } from "../tables.ts"
import { Segmented } from "./Segmented.tsx"

interface Pill {
	readonly key: string
	readonly kind: "filter" | "highlight"
	readonly label: string
	/** The first value, `+N` for the rest. */
	readonly value: string
	readonly full: string
	readonly clear: Partial<TableSearch>
}

/** One pill per active column filter, the market-cap floor and the highlight. */
const activePills = (config: TableConfig, view: ResolvedView, rows: ReadonlyArray<SnapshotRow>): Array<Pill> => {
	const pills: Array<Pill> = []
	for (const column of facetColumns(config)) {
		const selected = view.facets[column.facet.param]
		if (!selected) continue
		const labels = [...selected].map((value) => {
			const row = rows.find((r) => column.facet.value(r) === value)
			return row ? column.facet.label(value, row) : value
		})
		pills.push({
			key: column.id,
			kind: "filter",
			label: column.label,
			value: labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : labels[0]!,
			full: labels.join(", "),
			clear: facetPatch(config, column.facet.param, null),
		})
	}
	const floor = MARKET_CAP_FLOORS.find((f) => f.value === view.minCap)
	if (floor)
		pills.push({
			key: "mincap",
			kind: "filter",
			label: "MKT CAP",
			value: `≥ ${floor.label}`,
			full: `at least ${floor.label}`,
			clear: minCapPatch(null),
		})
	if (view.threshold > 0 && config.thresholds.length > 0)
		pills.push({
			key: "highlight",
			kind: "highlight",
			label: "HIGHLIGHT",
			value: `${view.highlight.label.replace(/\s*%$/, "")} > ${view.threshold}%`,
			full: `${view.highlight.title} above ${view.threshold}%`,
			clear: highlightPatch(config, view.highlight.id, 0),
		})
	return pills
}

const chipBase =
	"inline-flex h-[26px] shrink-0 items-center gap-1.5 border px-2.5 text-[11px] whitespace-nowrap max-sm:h-11"

/**
 * The row above the table: the source's own filter (fund category) or the highlight threshold,
 * then the row count and the table settings.
 */
/**
 * The row above the table: what filters and highlights the rows (each a pill that clears it, set from
 * the column menus), then the row count and the table settings.
 */
export function TableControls({
	config,
	view,
	rows,
	rowCount,
	onSearch,
}: {
	readonly config: TableConfig
	readonly view: ResolvedView
	/** Every row of the source, to name the filtered values. */
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly rowCount: number
	readonly onSearch: (patch: Partial<TableSearch>) => void
}) {
	const pills = activePills(config, view, rows)
	return (
		<div className="border-rule bg-bg flex shrink-0 items-center gap-2 border-b px-4 py-2.5 sm:flex-wrap lg:px-[18px]">
			<ul
				aria-label="Filters and highlight"
				className="flex min-w-0 items-center gap-2 max-sm:flex-1 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:overscroll-x-contain sm:flex-wrap"
			>
				{pills.length === 0 ? (
					<li className="text-dim text-[11px]">All rows · filter and highlight from the column menus</li>
				) : (
					pills.map((pill) => (
						<li key={pill.key}>
							<span
								className={cn(
									chipBase,
									"gap-0 pr-0",
									pill.kind === "highlight" ? "border-warm text-warm" : "border-rule-strong text-ink",
								)}
							>
								<span className="text-dim mr-1.5">{pill.label}</span>
								<span title={pill.full} className="max-w-56 truncate font-semibold">
									{pill.value}
								</span>
								<button
									type="button"
									aria-label={`Remove ${pill.label.toLowerCase()} ${pill.full}`}
									onClick={() => onSearch(pill.clear)}
									className="hover:text-ink text-dim ml-1 grid h-full w-6 place-items-center"
								>
									<X aria-hidden className="size-3" />
								</button>
							</span>
						</li>
					))
				)}
				{hasFilters(view) ? (
					<li>
						<button
							type="button"
							onClick={() => onSearch(clearFiltersPatch(config))}
							className="text-dim hover:text-ink px-1 text-[11px] tracking-[0.06em] whitespace-nowrap max-sm:min-h-11"
						>
							CLEAR FILTERS
						</button>
					</li>
				) : null}
			</ul>

			<div className="flex-1 max-sm:hidden" />

			<span className="border-rule text-dim border px-2.5 py-1 text-[11px] max-sm:hidden" aria-live="polite">
				<span className="text-ink font-semibold">{formatInteger(rowCount)}</span> rows
			</span>
			<TableSettings config={config} />
		</div>
	)
}

function TableSettings({ config }: { readonly config: TableConfig }) {
	const { prefs, update } = usePrefs()
	return (
		<Popover.Root>
			<Popover.Trigger
				className={cn(
					chipBase,
					"border-rule-strong tracking-[0.06em] text-dim hover:text-ink data-[popup-open]:bg-panel data-[popup-open]:text-ink",
				)}
			>
				<Settings2 aria-hidden className="size-3.5" />
				TABLE
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-40">
					<Popover.Popup className="popup border-rule-strong bg-panel text-ink w-72 border text-[11px] shadow-[0_12px_32px_rgb(0_0_0/0.5)] outline-none">
						<Popover.Title className="sr-only">Table settings</Popover.Title>
						<Segmented
							legend="DENSITY"
							options={["compact", "comfy"] as const}
							value={prefs.density}
							onChange={(density) => update({ ...prefs, density })}
						/>
						<Segmented
							legend="LAYOUT"
							options={["edge", "floating"] as const}
							value={prefs.layout}
							onChange={(layout) => update({ ...prefs, layout })}
						/>
						<label className="border-rule flex cursor-pointer items-center gap-2 border-b px-3.5 py-2.5">
							<input
								type="checkbox"
								checked={prefs.sparklines}
								onChange={(event) => update({ ...prefs, sparklines: event.currentTarget.checked })}
								className="accent-warm"
							/>
							Show sparkline chart
						</label>
						<ColumnPicker config={config} />
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

/** Returns first, then the descriptive columns; the identity columns are always shown and not listed. */
const COLUMN_GROUPS = [
	{ label: "RETURNS", test: (column: Column) => column.kind === "percent" },
	{ label: "INFO", test: (column: Column) => column.kind !== "percent" },
] as const

/** The optional columns as toggle chips, grouped, with shortcuts back to the defaults or to all of them. */
function ColumnPicker({ config }: { readonly config: TableConfig }) {
	const { prefs, update } = usePrefs()
	const optional = config.columns.filter((column) => !column.required)
	return (
		<fieldset className="px-3.5 pt-2.5 pb-3">
			<legend className="float-left mb-2 flex w-full items-center text-[11px]">
				<span className="text-warm tracking-[0.14em]">COLUMNS</span>
				<span className="ml-auto flex gap-3">
					<button
						type="button"
						onClick={() => update(withAllColumns(prefs, config.source, "default"))}
						className="text-dim hover:text-ink tracking-[0.06em]"
					>
						DEFAULT
					</button>
					<button
						type="button"
						onClick={() => update(withAllColumns(prefs, config.source, "all"))}
						className="text-dim hover:text-ink tracking-[0.06em]"
					>
						ALL
					</button>
				</span>
			</legend>
			<div className="clear-both">
				{COLUMN_GROUPS.map((group) => {
					const columns = optional.filter(group.test)
					if (columns.length === 0) return null
					return (
						<div key={group.label} className="mb-2.5 last:mb-0">
							<div className="text-dim mb-1.5 text-[11px] tracking-[0.1em]">{group.label}</div>
							<div className="flex flex-wrap gap-1.5">
								{columns.map((column) => {
									const on = isColumnVisible(prefs, config.source, column.id)
									return (
										<button
											key={column.id}
											type="button"
											aria-pressed={on}
											title={column.title}
											onClick={() => update(withColumn(prefs, config.source, column.id, !on))}
											className={cn(
												"inline-flex h-[26px] items-center border px-2 text-[11px] tracking-[0.06em] whitespace-nowrap max-sm:h-11",
												on
													? "border-warm bg-warm font-bold text-on-accent"
													: "border-rule-strong text-dim hover:text-ink",
											)}
										>
											{group.label === "RETURNS" ? column.label.replace(/\s*%$/, "") : column.label}
										</button>
									)
								})}
							</div>
						</div>
					)
				})}
			</div>
		</fieldset>
	)
}
