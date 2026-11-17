import type { SnapshotRow } from "#/shared/api.ts"
import type { SourceId } from "#/shared/sources.ts"

export interface NumericColumn {
	/** Stable id, also the URL value: ?sort=1m, ?period=7d. */
	readonly id: string
	readonly header: string
	/** Tooltip on the header. */
	readonly description?: string
	readonly value: (row: SnapshotRow) => number | null
	/** percent: "+1.23 %", coloured green/red. number: plain, coloured. price: plain. */
	readonly format: "percent" | "number" | "price"
}

export interface TableConfig {
	readonly source: SourceId
	readonly columns: ReadonlyArray<NumericColumn>
	/** Column sorted by default (descending). Crypto tables sort by the selected period by default. */
	readonly defaultSort: string
	/** Category filter (funds). `all` is always offered first. */
	readonly categories?: ReadonlyArray<{ readonly value: string; readonly label: string }>
	readonly defaultCategory?: string
	/** Columns selectable as "period": it drives the default sort and the threshold highlight. */
	readonly periods?: ReadonlyArray<string>
	readonly defaultPeriod?: string
	readonly thresholds?: ReadonlyArray<number>
	readonly defaultThreshold?: number
	/** Second line under the name, e.g. the fund's valuation date. */
	readonly subtitle?: (row: SnapshotRow) => string | null
}

/** Reads a stored metric; missing means no data. */
export const metric =
	(name: string) =>
	(row: SnapshotRow): number | null =>
		row.metrics[name] ?? null

export const percent = (id: string, metricName: string, header = `${id} %`): NumericColumn => ({
	id,
	header,
	value: metric(metricName),
	format: "percent",
})
