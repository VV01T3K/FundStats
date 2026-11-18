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
import { type KeyboardEvent, type MouseEvent, type ReactNode, useMemo, useState } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { cn } from "#/lib/utils"

import { formatCompact, formatDate, formatInteger, formatPercent, formatPrice, formatSigned } from "../format.ts"
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
			return formatPercent(value)
		case "momentum":
			return formatSigned(value)
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

	return (
		<table className="sheet w-full text-[13px]" data-sheet>
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
							"sticky-col edge pr-3 text-left",
							nameLeft,
							crypto
								? "min-w-[11rem] pl-2 sm:min-w-[20.25rem] sm:pl-[2.125rem] lg:min-w-[25.25rem]"
								: "min-w-[11.5rem] pl-4 sm:min-w-[20.75rem] sm:pl-[2.625rem] lg:min-w-[25.75rem]",
						)}
					>
						{sortButton(NAME_COLUMN, "Nazwa", null, "left")}
					</th>
					{numeric.map((column) => (
						<th
							key={column.id}
							scope="col"
							aria-sort={ariaSort(column.id)}
							className={cn("min-w-[4.5rem] px-2.5 text-right", column.format === "risk" && "pl-5")}
						>
							{sortButton(column.id, column.label, column.title, "right")}
						</th>
					))}
					{/* Takes the spare width, so the rules run edge to edge while the figures stay near the names. */}
					<th aria-hidden className="w-full min-w-4" />
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
							<td className={cn("sticky-col edge py-1.5 pr-3 sm:py-[3px]", nameLeft, crypto ? "pl-2" : "pl-4")}>
								<NameCell
									config={config}
									row={row}
									asOf={asOf}
									search={search}
									pinned={pinned}
									pinDisabled={!pinned && pinsFull}
									onTogglePin={() => onTogglePin(row.externalId)}
								/>
							</td>
							{numeric.map((column) => (
								<ValueCell key={column.id} column={column} row={row} />
							))}
							<td aria-hidden />
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
	onTogglePin,
}: {
	readonly config: TableConfig
	readonly row: SnapshotRow
	readonly asOf: string | null
	readonly search: TableSearch
	readonly pinned: boolean
	readonly pinDisabled: boolean
	readonly onTogglePin: () => void
}) {
	const fund = config.kind === "fund"
	const sub = fund
		? [
				row.category ? categoryLabel(row.category) : null,
				fundFamily(row),
				row.asOf && asOf && row.asOf !== asOf ? `wycena ${formatDate(row.asOf)}` : null,
			].filter((part) => part !== null)
		: []
	return (
		<div className="flex w-[9.75rem] items-center gap-1.5 sm:w-[19rem] lg:w-[24rem]">
			<button
				type="button"
				onClick={onTogglePin}
				disabled={pinDisabled}
				aria-pressed={pinned}
				aria-label={pinned ? `Odepnij ${row.name}` : `Przypnij ${row.name} do porównania`}
				title={
					pinDisabled ? `Można przypiąć najwyżej ${MAX_PINS}` : pinned ? "Odepnij (p)" : "Przypnij do porównania (p)"
				}
				tabIndex={-1}
				className={cn(
					"-ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded transition-[opacity,color] duration-150 max-sm:hidden",
					pinned
						? "text-accent"
						: "text-muted hover:text-fg opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 disabled:opacity-0",
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
						tabIndex={-1}
						className="truncate font-medium hover:underline"
						title={row.name}
					>
						{row.name}
					</Link>
					{!fund && row.symbol ? <span className="text-muted shrink-0 text-[11px]">{row.symbol}</span> : null}
					{pinned ? (
						<Pin aria-label="przypięty" className="text-accent size-3 shrink-0 fill-current sm:hidden" />
					) : null}
				</div>
				{sub.length > 0 ? (
					<div className="text-muted truncate text-[11px]" title={sub.join(" · ")}>
						{sub.join(" · ")}
					</div>
				) : null}
			</div>
		</div>
	)
}

function ValueCell({ column, row }: { readonly column: Column; readonly row: SnapshotRow }) {
	const value = column.value(row)
	const heat = column.heatCap === null ? 0 : heatStep(value, column.heatCap)
	const risk = column.format === "risk"
	return (
		<td
			data-heat={heat === 0 ? undefined : heat}
			title={
				risk && value !== null ? `Ryzyko ${value}/7${fundRiskName(row) ? ` — ${fundRiskName(row)}` : ""}` : undefined
			}
			className={cn(
				"num px-2.5 text-right",
				risk && "pl-5",
				column.format === "momentum" && "font-medium",
				column.format === "compact" && "text-muted",
			)}
		>
			{value === null ? <span className="text-muted">–</span> : formatCell(column, value)}
		</td>
	)
}
