import { Popover } from "@base-ui/react/popover"
import { Slider } from "@base-ui/react/slider"
import type { SnapshotRow } from "@fundstats/shared/api"
import { ArrowDown, ArrowUp, Check, ChevronDown, Filter, Highlighter, Search } from "lucide-react"
import { useState } from "react"

import { cn } from "#/lib/utils"

import { facetPatch, highlightPatch, minCapPatch, type ResolvedView, sortToPatch, type TableSearch } from "../search.ts"
import { type Column, type Facet, FUND_CATEGORIES, MARKET_CAP_FLOORS, type TableConfig } from "../tables.ts"
import { Segmented } from "./Segmented.tsx"

/** What a column's menu offers besides sorting; null: sorting only. */
export const columnMenuKind = (config: TableConfig, column: Column) =>
	column.facet
		? "facet"
		: column.kind === "percent" && config.thresholds.length > 0
			? "highlight"
			: column.id === "mcap"
				? "floor"
				: null

/** A menu lists a search box once it has more values than fit at a glance. */
const SEARCH_FROM = 8

const isFigure = (column: Column) =>
	column.kind === "percent" ||
	column.kind === "price" ||
	column.kind === "compact" ||
	column.kind === "rank" ||
	column.kind === "risk"

/**
 * A column's one control, beside its label: a small button that shows the column's state (an arrow
 * when sorted, a funnel when filtered or highlighted, a count when several values are picked) and
 * opens one menu with sorting, then whatever else the column offers: a value filter, its highlight,
 * or a market-cap floor.
 */
export function ColumnMenu({
	config,
	column,
	view,
	rows,
	onSearch,
}: {
	readonly config: TableConfig
	readonly column: Column
	readonly view: ResolvedView
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly onSearch: (patch: Partial<TableSearch>) => void
}) {
	const kind = columnMenuKind(config, column)
	const canSort = column.sortValue !== undefined
	if (kind === null && !canSort) return null
	const sorted = view.sort === column.id ? (view.desc ? "desc" : "asc") : null
	const selected = kind === "facet" ? view.facets[column.facet!.param] : undefined
	const filtered =
		kind === "facet"
			? selected !== undefined
			: kind === "highlight"
				? view.highlight.id === column.id && view.threshold > 0
				: kind === "floor" && view.minCap !== null
	const figure = isFigure(column)
	const sortItems = [
		{ desc: true, label: figure ? "Sort high to low" : "Sort Z to A", Icon: ArrowDown },
		{ desc: false, label: figure ? "Sort low to high" : "Sort A to Z", Icon: ArrowUp },
	].sort((a) => (a.desc === (column.firstDir === "desc") ? -1 : 1))
	const state = [
		sorted && `sorted ${sorted === "desc" ? "high to low" : "low to high"}`,
		filtered && (kind === "highlight" ? `highlight above ${view.threshold}%` : "filtered"),
	]
		.filter(Boolean)
		.join(", ")
	return (
		<Popover.Root>
			<Popover.Trigger
				aria-label={`${column.title}: sort${kind === "highlight" ? " and highlight" : kind ? " and filter" : ""}${state ? ` (${state})` : ""}`}
				title={state || undefined}
				className={cn(
					"group/btn relative inline-flex h-5 w-8 shrink-0 items-center justify-center gap-0.5 border align-middle max-sm:h-9 max-sm:w-10",
					filtered
						? "border-warm bg-warm/15 text-warm hover:bg-warm/25"
						: sorted
							? "border-warm text-warm hover:bg-panel-2 data-[popup-open]:bg-panel-2"
							: "border-rule-strong text-dim hover:text-ink hover:bg-panel-2 data-[popup-open]:text-ink data-[popup-open]:bg-panel-2",
				)}
			>
				{filtered ? (
					kind === "highlight" ? (
						<Highlighter aria-hidden className="size-3" />
					) : (
						<Filter aria-hidden className="size-3" fill="currentColor" />
					)
				) : !sorted ? (
					<ChevronDown
						aria-hidden
						className="size-3 transition-transform duration-200 group-data-[popup-open]/btn:rotate-180"
					/>
				) : null}
				{sorted === "desc" ? <ArrowDown aria-hidden className="size-3" /> : null}
				{sorted === "asc" ? <ArrowUp aria-hidden className="size-3" /> : null}
				{selected && selected.size > 1 ? (
					<span className="bg-warm text-on-accent absolute -top-2 -right-1.5 grid h-3.5 min-w-3.5 place-items-center px-0.5 text-[11px] leading-none font-bold tabular-nums">
						{selected.size}
					</span>
				) : null}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-40">
					<Popover.Popup
						className={cn(
							"popup border-rule-strong bg-panel text-ink border text-left text-[11px] font-normal tracking-normal normal-case shadow-[0_12px_32px_rgb(0_0_0/0.5)] outline-none",
							kind ? "w-64" : "w-52",
						)}
					>
						<Popover.Title className="text-dim border-rule border-b px-3.5 py-2 text-[11px] tracking-[0.1em] uppercase">
							{column.title}
						</Popover.Title>
						{canSort ? (
							<div role="group" aria-label="Sorting" className="py-1">
								{sortItems.map(({ desc, label, Icon }) => {
									const on = sorted === (desc ? "desc" : "asc")
									return (
										<Popover.Close
											key={label}
											aria-pressed={on}
											onClick={() => onSearch(sortToPatch(config, column.id, desc))}
											className={cn(
												"hover:bg-panel-2 flex min-h-7 w-full items-center gap-2.5 px-3.5 text-left max-lg:min-h-11",
												on ? "text-warm font-semibold" : "text-ink-dim hover:text-ink",
											)}
										>
											<Icon aria-hidden className="size-3.5 shrink-0" />
											<span className="flex-1">{label}</span>
											{on ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
										</Popover.Close>
									)
								})}
							</div>
						) : null}
						{kind ? (
							<div className={cn(canSort && "border-rule border-t")}>
								{kind === "facet" ? (
									<FacetList config={config} facet={column.facet!} view={view} rows={rows} onSearch={onSearch} />
								) : kind === "highlight" ? (
									<div className="px-3.5 pt-2.5 pb-3">
										<div className="text-warm mb-2 text-[11px] tracking-[0.14em]">HIGHLIGHT ABOVE</div>
										<ThresholdSlider
											stops={[0, ...config.thresholds]}
											value={view.highlight.id === column.id ? view.threshold : 0}
											onChange={(threshold) => onSearch(highlightPatch(config, column.id, threshold))}
											label={`Highlight ${column.title} above`}
										/>
									</div>
								) : (
									<Segmented
										legend="MARKET CAP AT LEAST"
										options={[
											{ id: "any", label: "ANY" },
											...MARKET_CAP_FLOORS.map((f) => ({ id: f.label, label: f.label })),
										]}
										value={MARKET_CAP_FLOORS.find((f) => f.value === view.minCap)?.label ?? "any"}
										onChange={(id) =>
											onSearch(minCapPatch(MARKET_CAP_FLOORS.find((f) => f.label === id)?.value ?? null))
										}
									/>
								)}
							</div>
						) : null}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

/** A column's values with how many rows have each; toggling one shows only the checked values. */
function FacetList({
	config,
	facet,
	view,
	rows,
	onSearch,
}: {
	readonly config: TableConfig
	readonly facet: Facet
	readonly view: ResolvedView
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly onSearch: (patch: Partial<TableSearch>) => void
}) {
	const [query, setQuery] = useState("")
	const counts = new Map<string, { count: number; label: string }>()
	for (const row of rows) {
		const value = facet.value(row)
		if (value === null) continue
		const entry = counts.get(value)
		if (entry) entry.count += 1
		else counts.set(value, { count: 1, label: facet.label(value, row) })
	}
	const order = (value: string) => {
		const category = FUND_CATEGORIES.findIndex((c) => c.value === value)
		return category >= 0 ? String(category) : value
	}
	const options = [...counts]
		.map(([value, entry]) => ({ value, ...entry }))
		.sort((a, b) => order(a.value).localeCompare(order(b.value), "pl", { numeric: true }))
	const selected = view.facets[facet.param]
	const visible = options.filter((o) => o.label.toLocaleLowerCase("pl").includes(query.trim().toLocaleLowerCase("pl")))
	const toggle = (value: string) => {
		const next = new Set(selected ?? [])
		if (next.has(value)) next.delete(value)
		else next.add(value)
		onSearch(facetPatch(config, facet.param, next.size === options.length ? null : next))
	}
	return (
		<div>
			{options.length >= SEARCH_FROM ? (
				<div className="border-rule relative border-b p-2">
					<Search
						aria-hidden
						className="text-dim pointer-events-none absolute top-1/2 left-4 size-3 -translate-y-1/2"
					/>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Find…"
						aria-label="Find a value"
						className="border-rule-strong bg-bg text-ink placeholder:text-dim focus:border-warm h-7 w-full border pr-2 pl-7 text-[11px] outline-none"
					/>
				</div>
			) : null}
			<ul className="max-h-[min(280px,50dvh)] overflow-auto overscroll-contain py-1">
				{visible.map((option) => {
					const on = selected?.has(option.value) ?? false
					return (
						<li key={option.value}>
							<button
								type="button"
								aria-pressed={on}
								onClick={() => toggle(option.value)}
								className="hover:bg-panel-2 flex min-h-7 w-full items-center gap-2.5 px-3.5 text-left max-lg:min-h-11"
							>
								<span
									aria-hidden
									className={cn(
										"grid size-3.5 shrink-0 place-items-center border",
										on ? "border-warm bg-warm text-on-accent" : "border-rule-strong",
									)}
								>
									{on ? <Check className="size-2.5" strokeWidth={3} /> : null}
								</span>
								<span className={cn("min-w-0 flex-1 truncate", on ? "text-ink" : "text-ink-dim")}>{option.label}</span>
								<span className="text-dim tabular-nums">{option.count}</span>
							</button>
						</li>
					)
				})}
				{visible.length === 0 ? <li className="text-dim px-3.5 py-2">No value matches.</li> : null}
			</ul>
			<div className="border-rule text-dim flex items-center border-t px-3.5 py-2">
				<span className="tabular-nums">
					{selected ? `${selected.size} of ${options.length}` : `All ${options.length}`}
				</span>
				<button
					type="button"
					disabled={!selected}
					onClick={() => onSearch(facetPatch(config, facet.param, null))}
					className="hover:text-ink ml-auto tracking-[0.06em] disabled:opacity-40"
				>
					SHOW ALL
				</button>
			</div>
		</div>
	)
}

/** Where `value` sits among `stops`: its own stop, or the nearest one for a hand-typed URL value. */
const stopIndex = (stops: ReadonlyArray<number>, value: number) =>
	stops.reduce((best, stop, i) => (Math.abs(stop - value) < Math.abs(stops[best]! - value) ? i : best), 0)

/**
 * The highlight threshold as a slider that only stops at the source's presets (and off), each marked
 * and labelled under the track, so it reads like the preset buttons it replaces.
 */
export function ThresholdSlider({
	stops,
	value,
	onChange,
	label,
}: {
	readonly stops: ReadonlyArray<number>
	readonly value: number
	readonly onChange: (value: number) => void
	readonly label: string
}) {
	const last = stops.length - 1
	const at = (i: number) => `${(i / last) * 100}%`
	return (
		<Slider.Root
			value={stopIndex(stops, value)}
			onValueChange={(index) => onChange(stops[index]!)}
			min={0}
			max={last}
			step={1}
			aria-label={label}
			className="w-full"
		>
			<Slider.Control className="relative flex h-[30px] cursor-pointer touch-none flex-col justify-start pt-[7px] max-sm:h-11 max-sm:pt-3">
				<Slider.Track className="bg-rule-strong relative mx-1.5 h-1">
					<Slider.Indicator className="bg-warm" />
					{stops.map((stop, i) => (
						<span
							key={stop}
							aria-hidden
							style={{ left: at(i) }}
							className={cn(
								"absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2",
								stop <= value && value > 0 ? "bg-warm" : "bg-rule-hover",
							)}
						/>
					))}
					<Slider.Thumb
						getAriaValueText={(_, index) => (stops[index]! > 0 ? `above ${stops[index]} percent` : "off")}
						className="bg-warm outline-warm size-3.5 border-2 border-[var(--bg)] has-[:focus-visible]:outline has-[:focus-visible]:outline-offset-1"
					/>
				</Slider.Track>
				<span aria-hidden className="relative mx-1.5 mt-1.5 block h-3">
					{stops.map((stop, i) => (
						<span
							key={stop}
							style={{ left: at(i) }}
							className={cn(
								"absolute -translate-x-1/2 text-[11px] leading-none tabular-nums",
								stop === stops[stopIndex(stops, value)] ? "text-warm font-bold" : "text-dim",
							)}
						>
							{stop === 0 ? "OFF" : stop}
						</span>
					))}
				</span>
			</Slider.Control>
		</Slider.Root>
	)
}
