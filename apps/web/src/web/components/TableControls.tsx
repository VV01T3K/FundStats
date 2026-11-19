import { Popover } from "@base-ui/react/popover"
import { Settings2, X } from "lucide-react"

import { cn } from "#/lib/utils"

import { formatInteger } from "../format.ts"
import { isColumnVisible, withAllColumns, withColumn } from "../prefs.ts"
import { usePrefs } from "../PrefsContext.tsx"
import {
	categoryPatch,
	clearExtraFiltersPatch,
	extraFilters,
	highlightPatch,
	type ResolvedView,
	type TableSearch,
} from "../search.ts"
import { type Column, FUND_CATEGORIES, type TableConfig } from "../tables.ts"
import { ThresholdSlider } from "./ColumnMenu.tsx"
import { Segmented } from "./Segmented.tsx"

const chipBase =
	"inline-flex h-[26px] shrink-0 items-center gap-1.5 border px-2.5 text-[11px] whitespace-nowrap max-sm:h-11"

/**
 * The row above the table: the source's own filter (fund category) or the highlight threshold,
 * then the row count and the table settings.
 */
/**
 * The row above the table: the source's own quick control (fund category chips, or the crypto
 * highlight slider), a chip for any other filter that is on, then the row count and table settings.
 */
export function TableControls({
	config,
	view,
	rowCount,
	onSearch,
}: {
	readonly config: TableConfig
	readonly view: ResolvedView
	readonly rowCount: number
	readonly onSearch: (patch: Partial<TableSearch>) => void
}) {
	const extra = extraFilters(view)
	const category = view.facets.category
	return (
		<div className="border-rule bg-bg flex shrink-0 items-center gap-2.5 border-b px-4 py-2.5 sm:flex-wrap lg:px-[18px]">
			{config.kind === "fund" ? (
				<div
					role="group"
					aria-labelledby="category-label"
					className="flex items-center gap-2 max-sm:min-w-0 max-sm:flex-1 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:overscroll-x-contain sm:flex-wrap"
				>
					<span id="category-label" className="text-dim mr-1 shrink-0 text-[11px]">
						Category:
					</span>
					{[{ value: null, label: "All" }, ...FUND_CATEGORIES].map((c) => {
						const on = c.value === null ? category === undefined : category?.size === 1 && category.has(c.value)
						return (
							<button
								key={c.label}
								type="button"
								aria-pressed={on}
								onClick={() => onSearch(categoryPatch(config, c.value))}
								className={cn(
									chipBase,
									"tracking-[0.06em] uppercase",
									on ? "border-warm bg-warm font-bold text-on-accent" : "border-rule-strong text-dim hover:text-ink",
								)}
							>
								{c.label}
							</button>
						)
					})}
				</div>
			) : (
				<div className="flex min-w-0 items-center gap-3 max-sm:flex-1">
					<span className="text-dim shrink-0 text-[11px] whitespace-nowrap">
						Highlight {view.highlight.id.toUpperCase()} &gt;
					</span>
					<div className="w-60 max-sm:min-w-0 max-sm:flex-1">
						<ThresholdSlider
							stops={[0, ...config.thresholds]}
							value={view.threshold}
							onChange={(threshold) => onSearch(highlightPatch(config, view.highlight.id, threshold))}
							label={`Highlight ${view.highlight.title} above`}
						/>
					</div>
				</div>
			)}

			<div className="flex-1 max-sm:hidden" />

			{extra > 0 ? (
				<button
					type="button"
					onClick={() => onSearch(clearExtraFiltersPatch)}
					title="Clear the filters set in the menu and the column menus"
					className={cn(chipBase, "border-warm text-warm hover:bg-warm hover:text-on-accent tracking-[0.06em]")}
				>
					{extra} {extra === 1 ? "FILTER" : "FILTERS"}
					<X aria-hidden className="size-3" />
				</button>
			) : null}

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
	{ label: "RETURNS", test: (column: Column) => column.kind === "percent" && !column.indicator },
	{ label: "INDICATORS", test: (column: Column) => column.indicator === true },
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
											{group.label !== "INFO" ? column.label.replace(/\s*%$/, "") : column.label}
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
