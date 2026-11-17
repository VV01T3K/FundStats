import {
	type ColumnDef,
	createSortedRowModel,
	rowSortingFeature,
	type SortingState,
	sortFn_alphanumeric,
	tableFeatures,
	useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { useMemo } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { cn } from "#/lib/utils"
import type { SnapshotRow } from "#/shared/api.ts"

import { formatNumber, formatPercent, formatPrice, trendClass } from "../format.ts"
import { NAME_COLUMN, type ResolvedView } from "../search.ts"
import type { NumericColumn, TableConfig } from "../tables/types.ts"

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric },
})

type Column = ColumnDef<typeof features, SnapshotRow>

const formatValue = (column: NumericColumn, value: number) =>
	column.format === "percent"
		? formatPercent(value)
		: column.format === "price"
			? formatPrice(value)
			: formatNumber(value)

const buildColumns = (config: TableConfig): Array<Column> => [
	{
		id: NAME_COLUMN,
		header: "Name",
		accessorFn: (row) => row.name,
		sortFn: "alphanumeric",
		cell: ({ row }) => {
			const subtitle = config.subtitle?.(row.original)
			return (
				<div className="max-w-[14rem] min-w-0 sm:max-w-[22rem]">
					<div className="truncate font-medium" title={row.original.name}>
						{row.original.name}
						{row.original.symbol && config.source !== "mbank" ? (
							<span className="text-muted-foreground ml-2 text-xs">{row.original.symbol}</span>
						) : null}
					</div>
					{subtitle ? <div className="text-muted-foreground text-xs">{subtitle}</div> : null}
				</div>
			)
		},
	},
	...config.columns.map((column): Column => ({
		id: column.id,
		header: column.header,
		accessorFn: (row) => column.value(row) ?? undefined,
		// Rows without data for the column always go to the bottom.
		sortUndefined: "last",
		sortDescFirst: true,
		meta: { numeric: true, description: column.description },
		cell: ({ getValue }) => {
			const value = (getValue() as number | undefined) ?? null
			if (value === null) return <span className="text-muted-foreground">–</span>
			return (
				<span className={column.format === "price" ? undefined : trendClass(value)}>{formatValue(column, value)}</span>
			)
		},
	})),
]

interface DataTableProps {
	readonly config: TableConfig
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly view: ResolvedView
	readonly onSortChange: (sort: string, desc: boolean) => void
}

/**
 * Generic snapshot table: client-side sorting on any column, green/red
 * changes, and rows above the threshold (on the selected period) highlighted.
 * Sorting lives in the URL; this component only reports changes.
 */
export function DataTable({ config, rows, view, onSortChange }: DataTableProps) {
	const columns = useMemo(() => buildColumns(config), [config])
	const data = useMemo(() => [...rows], [rows])
	const sorting = useMemo<SortingState>(() => [{ id: view.sort, desc: view.desc }], [view.sort, view.desc])
	const periodColumn = config.columns.find((c) => c.id === view.period)

	const table = useTable({
		features,
		columns,
		data,
		state: { sorting },
		enableSortingRemoval: false,
		enableMultiSort: false,
		onSortingChange: (updater) => {
			const next = typeof updater === "function" ? updater(sorting) : updater
			const first = next[0]
			if (first) onSortChange(first.id, first.desc)
		},
	})

	return (
		<Table>
			<TableHeader>
				{table.getHeaderGroups().map((group) => (
					<TableRow key={group.id}>
						<TableHead className="w-10 text-right">#</TableHead>
						{group.headers.map((header) => {
							const meta = header.column.columnDef.meta as { numeric?: boolean; description?: string } | undefined
							const sorted = header.column.getIsSorted()
							const label = (
								<button
									type="button"
									onClick={header.column.getToggleSortingHandler()}
									className={cn(
										"inline-flex items-center gap-1 hover:text-foreground",
										sorted && "text-foreground",
										header.column.id === view.period && "underline underline-offset-4",
									)}
									aria-label={`Sort by ${String(header.column.columnDef.header)}`}
								>
									<table.FlexRender header={header} />
									{sorted === "desc" ? (
										<ArrowDown className="size-3.5" />
									) : sorted === "asc" ? (
										<ArrowUp className="size-3.5" />
									) : (
										<ArrowUpDown className="size-3.5 opacity-40" />
									)}
								</button>
							)
							return (
								<TableHead
									key={header.id}
									className={meta?.numeric ? "text-right" : undefined}
									aria-sort={sorted === "desc" ? "descending" : sorted === "asc" ? "ascending" : "none"}
								>
									{meta?.description ? (
										<Tooltip>
											<TooltipTrigger asChild>{label}</TooltipTrigger>
											<TooltipContent>{meta.description}</TooltipContent>
										</Tooltip>
									) : (
										label
									)}
								</TableHead>
							)
						})}
					</TableRow>
				))}
			</TableHeader>
			<TableBody>
				{table.getRowModel().rows.map((row, index) => {
					const periodValue = periodColumn?.value(row.original) ?? null
					const highlighted = view.threshold > 0 && periodValue !== null && periodValue > view.threshold
					return (
						<TableRow
							key={row.id}
							className={cn(highlighted && "bg-highlight hover:bg-highlight")}
							data-highlighted={highlighted || undefined}
						>
							<TableCell className="text-muted-foreground text-right tabular-nums">{index + 1}</TableCell>
							{row.getAllCells().map((cell) => (
								<TableCell
									key={cell.id}
									className={cell.column.id === NAME_COLUMN ? undefined : "text-right tabular-nums"}
								>
									<table.FlexRender cell={cell} />
								</TableCell>
							))}
						</TableRow>
					)
				})}
				{rows.length === 0 ? (
					<TableRow>
						<TableCell colSpan={columns.length + 1} className="text-muted-foreground py-10 text-center">
							No rows match this filter.
						</TableCell>
					</TableRow>
				) : null}
			</TableBody>
		</Table>
	)
}
