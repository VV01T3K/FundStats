import { Popover } from "@base-ui/react/popover"
import { Settings2 } from "lucide-react"

import { cn } from "#/lib/utils"

import { formatInteger } from "../format.ts"
import { isColumnVisible, withColumn } from "../prefs.ts"
import { usePrefs } from "../PrefsContext.tsx"
import type { ResolvedView } from "../search.ts"
import { FUND_CATEGORIES, type TableConfig, THRESHOLD_CHIPS } from "../tables.ts"

const chipBase =
	"inline-flex h-[26px] shrink-0 items-center gap-1.5 border px-2.5 text-[11px] whitespace-nowrap max-sm:h-11"

/**
 * The row above the table: the source's own filter (fund category) or the highlight threshold,
 * then the row count and the table settings.
 */
export function TableControls({
	config,
	view,
	rowCount,
	onCategory,
	onThreshold,
}: {
	readonly config: TableConfig
	readonly view: ResolvedView
	readonly rowCount: number
	readonly onCategory: (value: string | null) => void
	readonly onThreshold: (value: number) => void
}) {
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
						const on = view.category === c.value
						return (
							<button
								key={c.label}
								type="button"
								aria-pressed={on}
								onClick={() => onCategory(c.value)}
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
				<div
					role="group"
					aria-labelledby="threshold-label"
					className="flex items-center gap-2 max-sm:min-w-0 max-sm:flex-1 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:overscroll-x-contain sm:flex-wrap"
				>
					<span id="threshold-label" className="text-dim mr-1 shrink-0 text-[11px] whitespace-nowrap">
						Highlight {view.highlight.id.toUpperCase()} &gt;
					</span>
					{THRESHOLD_CHIPS.map((t) => {
						const on = view.threshold === t
						return (
							<button
								key={t}
								type="button"
								aria-pressed={on}
								onClick={() => onThreshold(on ? 0 : t)}
								className={cn(
									chipBase,
									on ? "border-warm bg-warm font-bold text-on-accent" : "border-rule-strong text-dim hover:text-ink",
								)}
							>
								<span aria-hidden className={cn("size-1.5", on ? "bg-on-accent" : "bg-warm")} />
								{t}%
							</button>
						)
					})}
					{view.threshold > 0 && !THRESHOLD_CHIPS.some((t) => t === view.threshold) ? (
						<span className="text-warm text-[11px]">custom {view.threshold}%</span>
					) : null}
				</div>
			)}

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
					<Popover.Popup className="popup border-rule-strong bg-panel text-ink w-60 border text-[11px] shadow-[0_12px_32px_rgb(0_0_0/0.5)] outline-none">
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
						<fieldset className="max-h-[min(280px,50dvh)] overflow-auto overscroll-contain px-3.5 pt-2.5 pb-3">
							<legend className="text-warm float-left mb-1.5 w-full text-[10px] tracking-[0.14em]">COLUMNS</legend>
							<div className="clear-both">
								{config.columns.map((column) =>
									column.required ? (
										<label key={column.id} className="text-dim flex cursor-not-allowed items-center gap-2 py-1">
											<input type="checkbox" checked disabled className="accent-dim" />
											<span>{column.label}</span>
											<span className="ml-auto text-[9px]">REQUIRED</span>
										</label>
									) : (
										<label
											key={column.id}
											title={column.title}
											className={cn(
												"flex cursor-pointer items-center gap-2 py-1",
												isColumnVisible(prefs, config.source, column.id) ? "text-ink" : "text-dim",
											)}
										>
											<input
												type="checkbox"
												checked={isColumnVisible(prefs, config.source, column.id)}
												onChange={(event) =>
													update(withColumn(prefs, config.source, column.id, event.currentTarget.checked))
												}
												className="accent-warm"
											/>
											<span>{column.label}</span>
										</label>
									),
								)}
							</div>
						</fieldset>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

/** A popover section choosing one of `options`, the chosen one filled amber. */
function Segmented<Option extends string>({
	legend,
	options,
	value,
	onChange,
}: {
	readonly legend: string
	readonly options: ReadonlyArray<Option>
	readonly value: Option
	readonly onChange: (option: Option) => void
}) {
	return (
		<fieldset className="border-rule border-b px-3.5 pt-2.5 pb-2">
			<legend className="text-warm float-left mb-1.5 w-full text-[10px] tracking-[0.14em]">{legend}</legend>
			<div className="border-rule clear-both flex border">
				{options.map((option, i) => {
					const on = value === option
					return (
						<button
							key={option}
							type="button"
							aria-pressed={on}
							onClick={() => onChange(option)}
							className={cn(
								"h-7 flex-1 text-[10px] tracking-[0.08em] uppercase",
								i > 0 && "border-l border-rule",
								on ? "bg-warm font-bold text-on-accent" : "text-dim hover:text-ink",
							)}
						>
							{option}
						</button>
					)
				})}
			</div>
		</fieldset>
	)
}
