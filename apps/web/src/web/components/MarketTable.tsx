import type { SnapshotRow } from "@fundstats/shared/api"
import { KIND_SEGMENT, SOURCES } from "@fundstats/shared/sources"
import { Link, useNavigate } from "@tanstack/react-router"
import {
	type ColumnDef,
	createSortedRowModel,
	rowSortingFeature,
	type SortingState,
	sortFn_alphanumeric,
	sortFn_basic,
	tableFeatures,
	useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react"

import { cn } from "#/lib/utils"

import { formatCompact, formatDate, formatPercent, formatPrice, trend } from "../format.ts"
import type { Prefs } from "../prefs.ts"
import { isHighlighted, type ResolvedView } from "../search.ts"
import { categoryLabel, type Column, fundRisk, fundRiskName, longName, type TableConfig } from "../tables.ts"
import { Sparkline } from "./Sparkline.tsx"
import { Tip } from "./Tip.tsx"

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
})

type Def = ColumnDef<typeof features, SnapshotRow>

const CHART_COLUMN = "chart"

/** A steady colour per ticker for the square beside it, from the design's oklch(0.68 0.16 hue) family. */
const tickerHue = (text: string) => {
	let hash = 0
	for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360
	return hash
}

const TREND_TEXT = { up: "text-up", down: "text-down", flat: "text-ink-dim" } as const

const pad2 = (n: number) => String(n).padStart(2, "0")

interface MarketTableProps {
	readonly config: TableConfig
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly view: ResolvedView
	/** Visible columns, in config order. */
	readonly columns: ReadonlyArray<Column>
	readonly prefs: Prefs
	readonly sparklines: ReadonlyMap<string, ReadonlyArray<number>> | undefined
	/** The valuation date most rows share; other dates stand out. */
	readonly asOf: string | null
	readonly onSort: (columnId: string) => void
	readonly emptyAction?: ReactNode
}

/**
 * The terminal table: client-side sorting by the URL's sort, rows above the threshold tinted (the
 * highlighted figure keeps its place and width), a sparkline per row, and keyboard row navigation:
 * ↑/↓ or j/k move between rows, Enter opens one.
 */
export function MarketTable({
	config,
	rows,
	view,
	columns,
	prefs,
	sparklines,
	asOf,
	onSort,
	emptyAction,
}: MarketTableProps) {
	const navigate = useNavigate()
	const kind = KIND_SEGMENT[SOURCES[config.source].kind]
	const compact = prefs.density === "compact"
	const [focused, setFocused] = useState<string | null>(null)

	const defs = useMemo(
		(): Array<Def> => [
			...columns.map((column): Def => ({
				id: column.id,
				header: column.label,
				accessorFn: (row) => column.sortValue?.(row) ?? undefined,
				enableSorting: column.sortValue !== undefined,
				sortFn:
					column.kind === "percent" ||
					column.kind === "price" ||
					column.kind === "compact" ||
					column.kind === "rank" ||
					column.kind === "risk"
						? "basic"
						: "alphanumeric",
				sortUndefined: "last",
				sortDescFirst: column.firstDir === "desc",
			})),
			...(prefs.sparklines ? [{ id: CHART_COLUMN, header: "CHART", enableSorting: false } satisfies Def] : []),
		],
		[columns, prefs.sparklines],
	)
	const data = useMemo(() => [...rows], [rows])
	const sorting = useMemo<SortingState>(() => [{ id: view.sort, desc: view.desc }], [view.sort, view.desc])

	const table = useTable({
		features,
		columns: defs,
		data,
		state: { sorting },
		getRowId: (row) => row.externalId,
		enableSortingRemoval: false,
		enableMultiSort: false,
		onSortingChange: () => {},
	})

	const sorted = table.getRowModel().rows
	const activeId = focused !== null && sorted.some((r) => r.id === focused) ? focused : (sorted[0]?.id ?? null)

	const detail = (row: SnapshotRow) =>
		({
			to: "/$kind/$source/$externalId",
			params: { kind, source: config.source, externalId: row.externalId },
			search: (prev: Record<string, unknown>) => prev,
		}) as const

	const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
		const step =
			event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0
		if (step === 0 || event.altKey || event.metaKey || event.ctrlKey) return
		const index = sorted.findIndex((r) => r.id === activeId)
		const next = sorted[Math.max(0, Math.min(sorted.length - 1, index + step))]
		if (!next) return
		event.preventDefault()
		setFocused(next.id)
		;[...event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-row]")]
			.find((link) => link.dataset.row === next.id)
			?.focus()
	}

	const cellPad = compact ? "py-[5px]" : "py-2"
	const columnOf = (id: string) => columns.find((c) => c.id === id)

	return (
		<table className={cn("w-full border-separate border-spacing-0", compact ? "text-[11px]" : "text-[12px]")}>
			<thead>
				<tr>
					{table.getHeaderGroups()[0]!.headers.map((header, i) => {
						const column = columnOf(header.column.id)
						const sortedDir = header.column.getIsSorted()
						const right = column ? isNumeric(column) : true
						const label = (
							<span className="inline-flex items-center gap-1">
								{String(header.column.columnDef.header)}
								{sortedDir === "desc" ? (
									<ArrowDown aria-hidden className="size-3" />
								) : sortedDir === "asc" ? (
									<ArrowUp aria-hidden className="size-3" />
								) : null}
							</span>
						)
						return (
							<th
								key={header.id}
								scope="col"
								aria-sort={sortedDir === "desc" ? "descending" : sortedDir === "asc" ? "ascending" : undefined}
								data-wide={wide(column, view) || undefined}
								data-secondary={secondary(column, view) || undefined}
								className={cn(
									"sticky top-0 z-[2] border-b border-rule-strong bg-panel py-[7px] pr-3.5 pl-2 @max-[52rem]/market:pr-1.5 @max-[52rem]/market:pl-1.5 text-[10px] font-normal tracking-[0.1em] whitespace-nowrap uppercase",
									i === 0 && "pl-[18px] @max-[52rem]/market:pl-4",
									right ? "text-right" : "text-left",
									sortedDir ? "text-warm" : "text-dim",
									header.column.id === CHART_COLUMN && "pr-[18px] @max-[52rem]/market:pr-4",
								)}
							>
								{header.column.getCanSort() && column ? (
									<Tip label={column.title} side="top">
										<button
											type="button"
											onClick={() => onSort(column.id)}
											className="hover:text-ink inline-flex min-h-4 items-center uppercase max-sm:min-h-11"
										>
											{label}
										</button>
									</Tip>
								) : (
									label
								)}
							</th>
						)
					})}
				</tr>
			</thead>
			<tbody onKeyDown={onKeyDown}>
				{sorted.map((row, index) => {
					const highlighted = isHighlighted(view, row.original)
					return (
						<tr
							key={row.id}
							onClick={(event) => {
								if ((event.target as HTMLElement).closest("a, button")) return
								navigate(detail(row.original))
							}}
							className={cn(
								"group cursor-pointer",
								highlighted
									? "bg-[linear-gradient(90deg,rgb(247_185_85/0.07),rgb(247_185_85/0.02))] shadow-[inset_2px_0_0_var(--warm)]"
									: "hover:bg-panel",
							)}
							data-highlighted={highlighted || undefined}
						>
							{row.getAllCells().map((cell, i) => {
								const id = cell.column.id
								const column = columnOf(id)
								const right = column ? isNumeric(column) : true
								const tinted = highlighted && id === view.highlight.id
								return (
									<td
										key={cell.id}
										data-wide={wide(column, view) || undefined}
										data-secondary={secondary(column, view) || undefined}
										className={cn(
											"border-b border-rule pr-3.5 pl-2 align-middle whitespace-nowrap @max-[52rem]/market:pr-1.5 @max-[52rem]/market:pl-1.5",
											cellPad,
											i === 0 && "pl-[18px] @max-[52rem]/market:pl-4",
											right && "text-right",
											id === CHART_COLUMN && "pr-[18px] @max-[52rem]/market:pr-4",
											tinted && "bg-warm/14 font-bold",
											column && FILL[column.kind],
										)}
									>
										{id === CHART_COLUMN ? (
											<Sparkline
												values={sparklines?.get(row.id)}
												className="ml-auto block h-[18px] w-[90px] @max-[52rem]/market:h-3.5 @max-[52rem]/market:w-9"
											/>
										) : column?.kind === "ticker" || column?.kind === "fund" ? (
											<Link
												{...detail(row.original)}
												data-row={row.id}
												tabIndex={row.id === activeId ? 0 : -1}
												onFocus={() => setFocused(row.id)}
												className="block min-w-0 outline-none"
											>
												<Cell column={column} row={row.original} position={index + 1} asOf={asOf} />
											</Link>
										) : column ? (
											<Cell column={column} row={row.original} position={index + 1} asOf={asOf} />
										) : null}
									</td>
								)
							})}
						</tr>
					)
				})}
				{sorted.length === 0 ? (
					<tr>
						<td colSpan={defs.length} className="text-dim py-[60px] text-center">
							<div aria-hidden className="text-warm mb-2 text-[32px]">
								∅
							</div>
							No rows match the current filters.
							{emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
						</td>
					</tr>
				) : null}
			</tbody>
		</table>
	)
}

const isNumeric = (column: Column) =>
	column.kind === "percent" ||
	column.kind === "price" ||
	column.kind === "compact" ||
	column.kind === "rank" ||
	column.kind === "position"

/**
 * The name column takes the width the figures leave (`width: 100%; max-width: 0` makes an auto-layout
 * cell absorb the slack and truncate) so the table fills its container without ever overflowing it.
 * On phones, where crypto names drop out, the ticker takes that role.
 */
const FILL: Partial<Record<Column["kind"], string>> = {
	fund: "w-full max-w-0 min-w-[14ch]",
	name: "w-full max-w-0 min-w-[12ch]",
	ticker: "@max-[52rem]/market:w-full @max-[52rem]/market:max-w-0 @max-[52rem]/market:min-w-[9ch]",
}

/** Dropped on tablet-width tables, unless it is the column the table is sorted by. */
const secondary = (column: Column | undefined, view: ResolvedView) =>
	column?.secondary === true && column.id !== view.sort

/** Dropped on phone-width tables, unless it is the column the table is sorted by. */
const wide = (column: Column | undefined, view: ResolvedView) =>
	column === undefined ? false : !column.narrow && column.id !== view.sort

function Cell({
	column,
	row,
	position,
	asOf,
}: {
	readonly column: Column
	readonly row: SnapshotRow
	readonly position: number
	readonly asOf: string | null
}) {
	switch (column.kind) {
		case "position":
			return <span className="text-dim">{pad2(position)}</span>
		case "rank": {
			const rank = row.metrics.rank
			return <span className="text-dim">{rank === undefined ? "–" : pad2(rank)}</span>
		}
		case "ticker":
			return (
				<span className="flex min-w-0 items-center gap-2.5">
					<span
						aria-hidden
						className="size-[7px] shrink-0"
						style={{ background: `oklch(0.68 0.16 ${tickerHue(row.symbol ?? row.name)})` }}
					/>
					<span className="truncate font-semibold">{row.symbol ?? row.name}</span>
					{row.metrics.rank === undefined ? null : (
						<span className="text-dim hidden text-[10px] @max-[52rem]/market:inline">#{row.metrics.rank}</span>
					)}
				</span>
			)
		case "fund":
			return (
				<span title={longName(row) ?? row.name} className="text-ink block truncate font-semibold">
					{row.name}
				</span>
			)
		case "name":
			return <span className="text-ink-dim block truncate">{row.name}</span>
		case "category":
			return row.category ? (
				<span className="border-rule-strong text-warm border px-1.5 py-px text-[10px] tracking-[0.06em] uppercase">
					{categoryLabel(row.category)}
				</span>
			) : (
				<span className="text-dim">–</span>
			)
		case "risk": {
			const level = fundRisk(row)
			if (level === null) return <span className="text-dim">–</span>
			return (
				<span className="text-ink-dim">
					<span className="text-ink">{level}</span> {fundRiskName(row) ?? ""}
				</span>
			)
		}
		case "date":
			return row.asOf ? (
				<span
					className={row.asOf === asOf ? "text-dim" : "text-warm"}
					title={row.asOf === asOf ? undefined : "Valued on a different day than most funds"}
				>
					{formatDate(row.asOf)}
				</span>
			) : (
				<span className="text-dim">–</span>
			)
		case "percent": {
			const value = column.sortValue?.(row)
			if (typeof value !== "number") return <span className="text-dim">–</span>
			return <span className={TREND_TEXT[trend(value)]}>{formatPercent(value)}</span>
		}
		case "price":
			return row.value === null ? <span className="text-dim">–</span> : <span>{formatPrice(row.value)}</span>
		case "compact": {
			const value = column.sortValue?.(row)
			return typeof value === "number" ? (
				<span className="text-ink-dim">{formatCompact(value)}</span>
			) : (
				<span className="text-dim">–</span>
			)
		}
	}
}
