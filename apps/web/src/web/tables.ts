import type { SnapshotRow } from "@fundstats/shared/api"
import { MOMENTUM_FORMULA, type MetricName, momentum } from "@fundstats/shared/metrics"
import { type InstrumentKind, SOURCES, type SourceId } from "@fundstats/shared/sources"

import type { NounForms } from "./format.ts"
import { heatCap } from "./heat.ts"

type ColumnFormat = "percent" | "momentum" | "price" | "compact" | "risk" | "rank"

export interface Column {
	/** Stable id, also the URL value: ?sort=1m. */
	readonly id: string
	readonly label: string
	/** Header tooltip. */
	readonly title: string
	readonly format: ColumnFormat
	readonly value: (row: SnapshotRow) => number | null
	/** Direction of the first click on the header. */
	readonly firstDir: "asc" | "desc"
	/** Full-strength value of the heat wash; null = no wash. */
	readonly heatCap: number | null
}

export interface Preset {
	readonly id: string
	readonly label: string
	/** Period column ids, shown in the table config's order. */
	readonly columns: ReadonlyArray<string>
	readonly sort: string
}

export interface TableConfig {
	readonly source: SourceId
	readonly kind: InstrumentKind
	readonly title: string
	readonly noun: NounForms
	/** Columns presets choose from, in display order. */
	readonly periods: ReadonlyArray<Column>
	/** Shown after the periods in every preset. */
	readonly fixed: ReadonlyArray<Column>
	readonly presets: ReadonlyArray<Preset>
	readonly defaultPreset: string
}

export const NAME_COLUMN = "name"
export const RANK_COLUMN = "rank"

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
const marketCap = (row: SnapshotRow) => metadataNumber(row, "marketCap")
export const marketRank = (row: SnapshotRow) => row.metrics.rank ?? null

const change =
	(kind: InstrumentKind) =>
	(id: string, metric: MetricName, label: string, title: string): Column => ({
		id,
		label,
		title,
		format: "percent",
		value: (row) => row.metrics[metric] ?? null,
		firstDir: "desc",
		heatCap: heatCap(kind, id),
	})
const fundChange = change("fund")
const cryptoChange = change("crypto")

const FUND_PERIODS: ReadonlyArray<Column> = [
	{
		id: "mom",
		label: "Momentum",
		title: `Momentum ważone: ${MOMENTUM_FORMULA}`,
		format: "momentum",
		value: (row) => momentum(row.metrics),
		firstDir: "desc",
		heatCap: heatCap("fund", "mom"),
	},
	fundChange("1d", "change_1d", "1d", "Zmiana za 1 dzień"),
	fundChange("1m", "change_1m", "1m", "Zmiana za 1 miesiąc"),
	fundChange("3m", "change_3m", "3m", "Zmiana za 3 miesiące"),
	fundChange("6m", "change_6m", "6m", "Zmiana za 6 miesięcy"),
	fundChange("1y", "change_1y", "1r", "Zmiana za 1 rok"),
	fundChange("3y", "change_3y", "3l", "Zmiana za 3 lata"),
	fundChange("5y", "change_5y", "5l", "Zmiana za 5 lat"),
	fundChange("max", "change_max", "Od startu", "Zmiana od startu funduszu"),
]

const CRYPTO_PERIODS = {
	"1h": cryptoChange("1h", "change_1h", "1h", "Zmiana za 1 godzinę"),
	"24h": cryptoChange("24h", "change_24h", "24h", "Zmiana za 24 godziny"),
	"7d": cryptoChange("7d", "change_7d", "7d", "Zmiana za 7 dni"),
	"30d": cryptoChange("30d", "change_30d", "30d", "Zmiana za 30 dni"),
	"60d": cryptoChange("60d", "change_60d", "60d", "Zmiana za 60 dni"),
	"90d": cryptoChange("90d", "change_90d", "90d", "Zmiana za 90 dni"),
	"200d": cryptoChange("200d", "change_200d", "200d", "Zmiana za 200 dni"),
	"1y": cryptoChange("1y", "change_1y", "1r", "Zmiana za 1 rok"),
}

const price = (currency: string, label: string, title: string): Column => ({
	id: "price",
	label: `${label} ${currency}`,
	title,
	format: "price",
	value: (row) => row.value,
	firstDir: "desc",
	heatCap: null,
})

export const rankColumn: Column = {
	id: RANK_COLUMN,
	label: "#",
	title: "Pozycja w rankingu kapitalizacji u dostawcy",
	format: "rank",
	value: marketRank,
	firstDir: "asc",
	heatCap: null,
}

const cryptoFixed = (currency: string): ReadonlyArray<Column> => [
	price(currency, "Cena", `Cena w ${currency}`),
	{
		id: "mcap",
		label: `Kap. ${currency}`,
		title: `Kapitalizacja rynkowa w ${currency}`,
		format: "compact",
		value: marketCap,
		firstDir: "desc",
		heatCap: null,
	},
]

const CRYPTO_NOUN: NounForms = { one: "kryptowaluta", few: "kryptowaluty", many: "kryptowalut" }

const allOf = (periods: ReadonlyArray<Column>, sort: string): Preset => ({
	id: "wszystkie",
	label: "Wszystkie",
	columns: periods.map((c) => c.id),
	sort,
})

const crypto = (
	source: Exclude<SourceId, "mbank">,
	periodIds: ReadonlyArray<keyof typeof CRYPTO_PERIODS>,
	presets: ReadonlyArray<Preset>,
	allSort: string,
): TableConfig => {
	const periods = periodIds.map((id) => CRYPTO_PERIODS[id])
	return {
		source,
		kind: "crypto",
		title: SOURCES[source].name,
		noun: CRYPTO_NOUN,
		periods,
		fixed: cryptoFixed(SOURCES[source].currency),
		presets: [...presets, allOf(periods, allSort)],
		defaultPreset: "wszystkie",
	}
}

/** Column configuration per source. A new source only needs an entry here. */
export const TABLES = {
	mbank: {
		source: "mbank",
		kind: "fund",
		title: "Fundusze mBank",
		noun: { one: "fundusz", few: "fundusze", many: "funduszy" },
		periods: FUND_PERIODS,
		fixed: [
			{
				id: "risk",
				label: "Ryzyko",
				title: "Wskaźnik ryzyka w skali 1–7",
				format: "risk",
				value: fundRisk,
				firstDir: "desc",
				heatCap: null,
			},
			price("PLN", "Wartość j.u.", "Wartość jednostki uczestnictwa w PLN"),
		],
		presets: [
			{ id: "impet", label: "Impet", columns: ["mom", "1m", "3m", "6m", "1y"], sort: "mom" },
			{ id: "krotki", label: "Krótki", columns: ["1d", "1m", "3m"], sort: "1m" },
			{ id: "dlugi", label: "Długi", columns: ["1y", "3y", "5y", "max"], sort: "1y" },
			allOf(FUND_PERIODS, "mom"),
		],
		defaultPreset: "impet",
	},
	coingecko: crypto(
		"coingecko",
		["24h", "7d", "30d", "200d", "1y"],
		[
			{ id: "krotki", label: "Krótki", columns: ["24h", "7d", "30d"], sort: "7d" },
			{ id: "dlugi", label: "Długi", columns: ["30d", "200d", "1y"], sort: "1y" },
		],
		"1y",
	),
	// CoinPaprika's free API stores three periods only, so it has no presets to choose from.
	coinpaprika: crypto("coinpaprika", ["1h", "24h", "7d"], [], "7d"),
	coinmarketcap: crypto(
		"coinmarketcap",
		["1h", "24h", "7d", "30d", "60d", "90d"],
		[
			{ id: "krotki", label: "Krótki", columns: ["1h", "24h", "7d"], sort: "24h" },
			{ id: "dlugi", label: "Długi", columns: ["30d", "60d", "90d"], sort: "30d" },
		],
		"30d",
	),
} satisfies Record<SourceId, TableConfig>

export const getTable = (source: SourceId): TableConfig => TABLES[source]

/** Fund categories as mBank names them, in the order the filter offers them. */
export const FUND_CATEGORIES: ReadonlyArray<{
	readonly value: string
	readonly plural: string
	readonly singular: string
}> = [
	{ value: "akcyjny", plural: "Akcyjne", singular: "Akcyjny" },
	{ value: "mieszany", plural: "Mieszane", singular: "Mieszany" },
	{ value: "dłużny", plural: "Dłużne", singular: "Dłużny" },
	{ value: "alternatywny", plural: "Alternatywne", singular: "Alternatywny" },
]

export const categoryLabel = (value: string) => FUND_CATEGORIES.find((c) => c.value === value)?.singular ?? value

export const RISK_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const
