import type { SnapshotRow } from "@fundstats/shared/api"
import type { SourceId } from "@fundstats/shared/sources"
import { Link } from "@tanstack/react-router"
import {
	type ColumnDef,
	createSortedRowModel,
	rowSortingFeature,
	type SortingState,
	tableFeatures,
	useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, Pin } from "lucide-react"
import { type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, useMemo, useState } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { cn } from "#/lib/utils"

import { formatCompact, formatDate, formatInteger, formatPercent, formatPrice } from "../format.ts"
import { heatStep } from "../heat.ts"
import { MAX_PINS, type ResolvedView, type TableSearch } from "../search.ts"
import {
	categoryLabel,
	type Column,
	fundFamily,
	fundRiskName,
	NAME_COLUMN,
	RANK_COLUMN,
	type TableConfig,
} from "../tables.ts"

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })

type Def = ColumnDef<typeof features, SnapshotRow>

const collator = new Intl.Collator("pl-PL", { sensitivity: "base", numeric: true })

const buildDefs = (columns: ReadonlyArray<Column>): Array<Def> => [
	{
		id: NAME_COLUMN,
		accessorFn: (row) => row.name,
		sortFn: (a, b) => collator.compare(a.original.name, b.original.name),
	},
	...columns.map((column): Def => ({
		id: column.id,
		accessorFn: (row) => column.value(row) ?? undefined,
		// Missing values sit at the bottom in both directions.
		sortUndefined: "last",
		sortFn: (a, b, id) => (a.getValue(id) as number) - (b.getValue(id) as number),
	})),
]

export const formatCell = (column: Column, value: number) => {
	switch (column.format) {
		case "percent":
		case "momentum":
			return formatPercent(value)
		case "price":
			return formatPrice(value)
		case "compact":
			return formatCompact(value)
		case "risk":
		case "rank":
			return formatInteger(value)
	}
}

export interface SheetProps {
	readonly config: TableConfig
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly view: ResolvedView
	readonly search: TableSearch
	/** The valuation date most rows share; a fund valued on another day shows its own date. */
	readonly asOf: string | null
	readonly onSort: (columnId: string) => void
	readonly onTogglePin: (externalId: string) => void
	readonly onOpen: (externalId: string) => void
	readonly empty: ReactNode
}

/** Column widths from `sm` up (in rem), so the name column can take what the figures leave. */
const COLUMN_REM: Record<Column["format"], number> = {
	percent: 6,
	momentum: 6.25,
	price: 7.75,
	compact: 6,
	risk: 5.5,
	rank: 3,
}

const isInteractive = (target: EventTarget) => target instanceof Element && target.closest("a, button") !== null

/** The ranked table shared by funds and crypto: native semantics, sticky header and identity column. */
export function Sheet({ config, rows, view, search, asOf, onSort, onTogglePin, onOpen, empty }: SheetProps) {
	const defs = useMemo(() => buildDefs(view.columns), [view.columns])
	const data = useMemo(() => [...rows], [rows])
	const sorting = useMemo<SortingState>(() => [{ id: view.sort, desc: view.desc }], [view.sort, view.desc])
	const table = useTable({ features, columns: defs, data, state: { sorting } })
	const sorted = table.getRowModel().rows
	const [active, setActive] = useState(0)
	const activeIndex = Math.min(active, Math.max(sorted.length - 1, 0))
	const crypto = config.kind === "crypto"
	const pinsFull = view.pins.length >= MAX_PINS
	const numeric = view.columns.filter((c) => c.id !== RANK_COLUMN)

	const focusRow = (body: HTMLElement, index: number) => {
		const target = body.querySelector<HTMLElement>(`tr[data-index="${index}"]`)
		target?.focus()
	}

	const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return
		const row = (event.target as Element).closest<HTMLElement>("tr[data-index]")
		if (!row) return
		const index = Number(row.dataset.index)
		const externalId = sorted[index]?.original.externalId
		const move = (to: number) => {
			event.preventDefault()
			focusRow(event.currentTarget, Math.max(0, Math.min(sorted.length - 1, to)))
		}
		switch (event.key) {
			case "j":
			case "ArrowDown":
				return move(index + 1)
			case "k":
			case "ArrowUp":
				return move(index - 1)
			case "Home":
				return move(0)
			case "End":
				return move(sorted.length - 1)
			case "Enter":
				if (externalId && event.target === row) {
					event.preventDefault()
					onOpen(externalId)
				}
				return
			case "p":
				if (externalId) {
					event.preventDefault()
					onTogglePin(externalId)
				}
				return
		}
	}

	const onRowClick = (event: MouseEvent, externalId: string) => {
		if (isInteractive(event.target) || window.getSelection()?.toString()) return
		onOpen(externalId)
	}

	const sortButton = (id: string, label: string, title: string | null, align: "left" | "right") => {
		const isSorted = view.sort === id
		const button = (
			<button
				type="button"
				onClick={() => onSort(id)}
				className={cn(
					"inline-flex h-9 w-full items-center gap-1 whitespace-nowrap transition-colors duration-150",
					align === "right" ? "justify-end" : "justify-start",
					isSorted ? "text-fg" : "text-muted hover:text-fg",
				)}
			>
				{align === "right" ? <SortArrow sorted={isSorted} desc={view.desc} /> : null}
				{label}
				{align === "left" ? <SortArrow sorted={isSorted} desc={view.desc} /> : null}
			</button>
		)
		if (!title) return button
		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent side="bottom">{title}</TooltipContent>
			</Tooltip>
		)
	}

	const ariaSort = (id: string) => (view.sort === id ? (view.desc ? "descending" : "ascending") : undefined)
	const nameLeft = crypto ? "left-12" : "left-0"
	// Everything but the name text: figures, the rank column, the name cell's padding and a sliver of spacer.
	const fixedRem = numeric.reduce((sum, column) => sum + COLUMN_REM[column.format], 0) + (crypto ? 3 + 1.25 : 1.75) + 1

	return (
		<table
			className="sheet w-full text-[13px]"
			data-sheet
			data-kind={config.kind}
			style={{ "--fixed-w": `${fixedRem}rem` } as CSSProperties}
		>
			<thead>
				<tr className="text-xs font-medium">
					{crypto ? (
						<th
							scope="col"
							aria-sort={ariaSort(RANK_COLUMN)}
							className="sticky-col left-0 w-12 min-w-12 pr-1 pl-4 text-right"
						>
							{sortButton(RANK_COLUMN, "#", "Pozycja w rankingu kapitalizacji u dostawcy", "right")}
						</th>
					) : null}
					<th
						scope="col"
						aria-sort={ariaSort(NAME_COLUMN)}
						className={cn(
							"sticky-col edge pr-2 text-left sm:pr-3",
							nameLeft,
							crypto
								? "min-w-[9.75rem] pl-[2.125rem] sm:min-w-[calc(var(--name-w)+1.25rem)]"
								: "min-w-[12.75rem] pl-[2.625rem] sm:min-w-[calc(var(--name-w)+1.75rem)]",
						)}
					>
						{sortButton(NAME_COLUMN, "Nazwa", null, "left")}
					</th>
					{numeric.map((column) => (
						<th
							key={column.id}
							scope="col"
							aria-sort={ariaSort(column.id)}
							style={{ "--col-w": `${COLUMN_REM[column.format]}rem` } as CSSProperties}
							className={cn(
								"snap-start px-2 text-right sm:w-[var(--col-w)] sm:min-w-[var(--col-w)] sm:px-2.5",
								column.format === "risk" && "pl-3 sm:pl-5",
							)}
						>
							{sortButton(column.id, column.label, column.title, "right")}
						</th>
					))}
					{/* Takes the spare width, so the rules run edge to edge while the figures stay near the names. */}
					<th aria-hidden className="spacer w-full min-w-4" />
				</tr>
			</thead>
			<tbody onKeyDown={onKeyDown}>
				{sorted.map((tableRow, index) => {
					const row = tableRow.original
					const pinned = view.pins.includes(row.externalId)
					return (
						<tr
							key={row.externalId}
							data-index={index}
							tabIndex={index === activeIndex ? 0 : -1}
							onFocus={() => setActive(index)}
							onClick={(event) => onRowClick(event, row.externalId)}
							className="group cursor-default scroll-mt-9 outline-none"
						>
							{crypto ? (
								<td className="sticky-col num text-muted left-0 w-12 min-w-12 pr-1 pl-4 text-right text-xs">
									{row.metrics.rank === undefined ? "–" : formatInteger(row.metrics.rank)}
								</td>
							) : null}
							<td className={cn("sticky-col edge py-1.5 pr-2 sm:py-[3px] sm:pr-3", nameLeft, crypto ? "pl-2" : "pl-4")}>
								<NameCell
									config={config}
									row={row}
									asOf={asOf}
									search={search}
									pinned={pinned}
									pinDisabled={!pinned && pinsFull}
									focusable={index === activeIndex}
									onTogglePin={() => onTogglePin(row.externalId)}
								/>
							</td>
							{numeric.map((column) => (
								<ValueCell key={column.id} column={column} row={row} />
							))}
							<td aria-hidden className="spacer" />
						</tr>
					)
				})}
				{sorted.length === 0 ? (
					<tr>
						<td colSpan={numeric.length + (crypto ? 3 : 2)} className="px-4 py-12">
							{empty}
						</td>
					</tr>
				) : null}
			</tbody>
		</table>
	)
}

function SortArrow({ sorted, desc }: { readonly sorted: boolean; readonly desc: boolean }) {
	if (!sorted) return <span aria-hidden className="inline-block size-3" />
	return desc ? <ArrowDown aria-hidden className="size-3" /> : <ArrowUp aria-hidden className="size-3" />
}

function NameCell({
	config,
	row,
	asOf,
	search,
	pinned,
	pinDisabled,
	focusable,
	onTogglePin,
}: {
	readonly config: TableConfig
	readonly row: SnapshotRow
	readonly asOf: string | null
	readonly search: TableSearch
	readonly pinned: boolean
	readonly pinDisabled: boolean
	/** The row holding the sheet's roving focus: its link and pin are in the Tab order. */
	readonly focusable: boolean
	readonly onTogglePin: () => void
}) {
	const fund = config.kind === "fund"
	const ownDate = fund && row.asOf && asOf && row.asOf !== asOf ? `wycena ${formatDate(row.asOf)}` : null
	const category = fund && row.category ? categoryLabel(row.category) : null
	const family = fund ? fundFamily(row) : null
	return (
		<div className={cn("flex items-center gap-1.5 sm:w-[var(--name-w)]", fund ? "w-[11.25rem]" : "w-[8.75rem]")}>
			<button
				type="button"
				onClick={onTogglePin}
				disabled={pinDisabled}
				aria-pressed={pinned}
				aria-label={pinned ? `Odepnij ${row.name}` : `Przypnij ${row.name} do porównania`}
				title={
					pinDisabled ? `Można przypiąć najwyżej ${MAX_PINS}` : pinned ? "Odepnij (p)" : "Przypnij do porównania (p)"
				}
				tabIndex={focusable ? 0 : -1}
				className={cn(
					// The hit area reaches 44px on phones without widening the column.
					"relative -ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded transition-[opacity,color] duration-150 before:absolute before:-inset-2.5 before:content-['']",
					pinned
						? "text-accent"
						: "text-muted hover:text-fg opacity-50 disabled:opacity-20 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:disabled:opacity-0",
				)}
			>
				<Pin className={cn("size-3.5", pinned && "fill-current")} />
			</button>
			<div className="min-w-0 flex-1 leading-tight">
				<div className="flex min-w-0 items-baseline gap-1.5">
					<Link
						to="/$kind/$source/$externalId"
						params={{ kind: fund ? "funds" : "crypto", source: config.source as SourceId, externalId: row.externalId }}
						search={search}
						tabIndex={focusable ? 0 : -1}
						className="truncate font-medium hover:underline"
						title={row.name}
					>
						{row.name}
					</Link>
					{!fund && row.symbol ? <span className="text-muted shrink-0 text-[11px]">{row.symbol}</span> : null}
				</div>
				{fund ? (
					<div
						className="text-muted flex min-w-0 text-[11px]"
						title={[ownDate, category, family].filter(Boolean).join(" · ")}
					>
						{/* An exception to the table's valuation date is never truncated. */}
						{ownDate ? <span className="text-fg/75 shrink-0 font-medium">{ownDate}</span> : null}
						<span className="truncate">
							{ownDate && category ? "\u00A0· " : null}
							{category}
							{family ? (
								<span className="max-sm:hidden">
									{category ? " · " : null}
									{family}
								</span>
							) : null}
						</span>
					</div>
				) : null}
			</div>
		</div>
	)
}

function ValueCell({ column, row }: { readonly column: Column; readonly row: SnapshotRow }) {
	const value = column.value(row)
	const heat = column.heatCap === null ? 0 : heatStep(value, column.heatCap)
	const riskName = column.format === "risk" && value !== null ? fundRiskName(row) : null
	return (
		<td
			data-heat={heat === 0 ? undefined : heat}
			className={cn(
				"num px-2 text-right sm:px-2.5",
				column.format === "risk" && "pl-3 sm:pl-5",
				column.format === "momentum" && "font-medium",
				column.format === "compact" && "text-muted",
			)}
		>
			{value === null ? (
				<span className="text-muted">–</span>
			) : riskName ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<span>{formatCell(column, value)}</span>
					</TooltipTrigger>
					<TooltipContent side="left">
						Ryzyko {value}/7 · {riskName}
					</TooltipContent>
				</Tooltip>
			) : (
				formatCell(column, value)
			)}
		</td>
	)
}
