import type { SnapshotRow } from "@fundstats/shared/api"
import { MOMENTUM_FORMULA, type MetricName, momentum } from "@fundstats/shared/metrics"
import { type InstrumentKind, SOURCES, type SourceId } from "@fundstats/shared/sources"

/**
 * How a cell renders. `position`: the row's place in the current order; `rank`: the upstream's market
 * rank; `ticker`/`fund`: the identity cell that links to the detail page.
 */
type ColumnKind =
	| "position"
	| "rank"
	| "ticker"
	| "fund"
	| "name"
	| "category"
	| "risk"
	| "date"
	| "percent"
	| "price"
	| "compact"

export interface Column {
	/** Stable id, also the URL value: ?sort=1m. */
	readonly id: string
	readonly label: string
	/** Header tooltip and the name in table settings. */
	readonly title: string
	readonly kind: ColumnKind
	/** What sorting compares; null always sorts last. Columns without one do not sort. */
	readonly sortValue?: (row: SnapshotRow) => number | string | null
	/** Direction of the first click on the header. */
	readonly firstDir: "asc" | "desc"
	/** Always shown; table settings list it as required. */
	readonly required?: boolean
	/** Off until the viewer turns it on in table settings. */
	readonly hidden?: boolean
	/** Kept on phones: the identity, the price and the sorted column; the rest drop out. */
	readonly narrow?: boolean
	/** Descriptive, not a figure: the first to go when a tablet-width table runs out of room. */
	readonly secondary?: boolean
}

export interface TableConfig {
	readonly source: SourceId
	readonly kind: InstrumentKind
	/** Tab title, e.g. `mBank · Funds`. */
	readonly title: string
	/** Tab subtitle. */
	readonly tagline: string
	readonly columns: ReadonlyArray<Column>
	/** Sorted by default, in its first direction; also the default highlight column. */
	readonly defaultSort: string
	/** Highlight above this change (percent); 0 = off. */
	readonly defaultThreshold: number
}

/** The highlight slider moves in 5% steps (keyboard: arrows by one step, Page Up/Down by two). */
export const THRESHOLD_STEP = 5
export const THRESHOLD_MAX = 100

const metadataNumber = (row: SnapshotRow, key: string) => {
	const value = row.metadata[key]
	return typeof value === "number" && Number.isFinite(value) ? value : null
}
const metadataText = (row: SnapshotRow, key: string) => {
	const value = row.metadata[key]
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export const fundRisk = (row: SnapshotRow) => metadataNumber(row, "riskScale")
export const fundRiskName = (row: SnapshotRow) => metadataText(row, "riskName")
export const fundFamily = (row: SnapshotRow) => metadataText(row, "umbrella")
export const longName = (row: SnapshotRow) => metadataText(row, "longName")
export const marketCap = (row: SnapshotRow) => metadataNumber(row, "marketCap")

const change = (id: string, metric: MetricName, title: string, hidden = false): Column => ({
	id,
	label: `${id.toUpperCase()} %`,
	title,
	kind: "percent",
	sortValue: (row) => row.metrics[metric] ?? null,
	firstDir: "desc",
	...(hidden ? { hidden } : {}),
})

/** Coins keep their price on phones; a fund's unit value means little without its history. */
const price = (currency: string, label: string): Column => ({
	id: "price",
	label: `${label} ${currency}`,
	title: `${label === "UNIT" ? "Unit value" : "Price"} in ${currency}`,
	kind: "price",
	sortValue: (row) => row.value,
	firstDir: "desc",
	narrow: label === "PRICE",
})

const byName = (row: SnapshotRow) => row.name

/** Fund categories as mBank names them, in the order the filter offers them. */
export const FUND_CATEGORIES = [
	{ value: "akcyjny", label: "Akcyjne", singular: "Akcyjny" },
	{ value: "mieszany", label: "Mieszane", singular: "Mieszany" },
	{ value: "dłużny", label: "Dłużne", singular: "Dłużny" },
	{ value: "alternatywny", label: "Alternatywne", singular: "Alternatywny" },
] as const

export const categoryLabel = (value: string) => FUND_CATEGORIES.find((c) => c.value === value)?.singular ?? value

const CRYPTO_CHANGES = {
	"1h": change("1h", "change_1h", "Change over 1 hour"),
	"24h": change("24h", "change_24h", "Change over 24 hours"),
	"7d": change("7d", "change_7d", "Change over 7 days"),
	"30d": change("30d", "change_30d", "Change over 30 days"),
	"60d": change("60d", "change_60d", "Change over 60 days"),
	"90d": change("90d", "change_90d", "Change over 90 days"),
	"200d": change("200d", "change_200d", "Change over 200 days"),
	"1y": change("1y", "change_1y", "Change over 1 year"),
}

const crypto = (
	source: Exclude<SourceId, "mbank">,
	periods: ReadonlyArray<keyof typeof CRYPTO_CHANGES>,
	defaultSort: string,
	defaultThreshold: number,
): TableConfig => {
	const { name, currency } = SOURCES[source]
	return {
		source,
		kind: "crypto",
		title: name,
		tagline: `Top 100 · ${currency} · ${periods.map((p) => p.toUpperCase()).join(" / ")}`,
		columns: [
			{
				id: "rank",
				label: "#",
				title: "Market cap rank at the source",
				kind: "rank",
				sortValue: (row) => row.metrics.rank ?? null,
				firstDir: "asc",
				required: true,
			},
			{
				id: "ticker",
				label: "TICKER",
				title: "Ticker",
				kind: "ticker",
				sortValue: (row) => row.symbol ?? row.name,
				firstDir: "asc",
				required: true,
				narrow: true,
			},
			{ id: "name", label: "NAME", title: "Name", kind: "name", sortValue: byName, firstDir: "asc", secondary: true },
			price(currency, "PRICE"),
			...periods.map((p) => CRYPTO_CHANGES[p]),
			{
				id: "mcap",
				label: "MKT CAP",
				title: `Market capitalisation in ${currency}`,
				kind: "compact",
				sortValue: marketCap,
				firstDir: "desc",
				secondary: true,
			},
		],
		defaultSort,
		defaultThreshold,
	}
}

/** Column configuration per source. A new source only needs an entry here. */
export const TABLES = {
	mbank: {
		source: "mbank",
		kind: "fund",
		title: "mBank · Funds",
		tagline: `Polish funds — ${FUND_CATEGORIES.map((c) => c.label).join(" · ")}`,
		columns: [
			{
				id: "position",
				label: "#",
				title: "Place in the current order",
				kind: "position",
				firstDir: "asc",
				required: true,
				narrow: true,
			},
			{
				id: "name",
				label: "FUND",
				title: "Fund",
				kind: "fund",
				sortValue: byName,
				firstDir: "asc",
				required: true,
				narrow: true,
			},
			{
				id: "category",
				label: "TYPE",
				title: "Fund category",
				kind: "category",
				sortValue: (row) => row.category,
				firstDir: "asc",
				secondary: true,
			},
			{
				id: "risk",
				label: "RISK",
				title: "Risk level on mBank's own scale",
				kind: "risk",
				sortValue: fundRisk,
				firstDir: "asc",
				hidden: true,
				secondary: true,
			},
			{
				id: "asOf",
				label: "AS OF",
				title: "Valuation date",
				kind: "date",
				sortValue: (row) => row.asOf,
				firstDir: "desc",
			},
			change("1d", "change_1d", "Change over 1 day", true),
			change("1m", "change_1m", "Change over 1 month"),
			change("3m", "change_3m", "Change over 3 months"),
			change("6m", "change_6m", "Change over 6 months"),
			change("1y", "change_1y", "Change over 1 year"),
			{
				id: "mom",
				label: "MOM %",
				title: `Weighted momentum: ${MOMENTUM_FORMULA}`,
				kind: "percent",
				sortValue: (row) => momentum(row.metrics),
				firstDir: "desc",
			},
			change("3y", "change_3y", "Change over 3 years", true),
			change("5y", "change_5y", "Change over 5 years", true),
			change("max", "change_max", "Change since the fund's launch", true),
			price("PLN", "UNIT"),
		],
		defaultSort: "1m",
		defaultThreshold: 0,
	},
	coingecko: crypto("coingecko", ["24h", "7d", "30d", "200d", "1y"], "1y", 50),
	coinpaprika: crypto("coinpaprika", ["1h", "24h", "7d"], "7d", 10),
	coinmarketcap: crypto("coinmarketcap", ["1h", "24h", "7d", "30d", "60d", "90d"], "30d", 40),
} satisfies Record<SourceId, TableConfig>

export const getTable = (source: SourceId): TableConfig => TABLES[source]

export const columnOf = (config: TableConfig, id: string) => config.columns.find((c) => c.id === id)

/** A percent column's value for a row, as the highlight and the detail page read it. */
export const percentValue = (column: Column, row: SnapshotRow) => {
	const value = column.sortValue?.(row)
	return typeof value === "number" ? value : null
}
