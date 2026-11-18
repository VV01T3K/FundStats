import { MOMENTUM_FORMULA, momentum } from "@fundstats/shared/metrics"
import type { SourceId } from "@fundstats/shared/sources"

import { percent, type TableConfig } from "./types.ts"

const price = (header: string) =>
	({ id: "price", header, value: (row) => row.value, format: "price" }) satisfies TableConfig["columns"][number]

const cryptoThresholds = [5, 10, 20, 30, 40, 50]

/** Column configuration per source. A new source only needs an entry here. */
export const TABLES = {
	mbank: {
		source: "mbank",
		columns: [
			percent("1m", "change_1m"),
			percent("3m", "change_3m"),
			percent("6m", "change_6m"),
			percent("1y", "change_1y"),
			{
				id: "mom",
				header: "Mom.",
				description: `Weighted momentum: ${MOMENTUM_FORMULA}`,
				value: (row) => momentum(row.metrics),
				format: "number",
			},
			percent("3y", "change_3y"),
			price("Unit value"),
		],
		defaultSort: "1m",
		categories: [
			{ value: "akcyjny", label: "Akcyjne" },
			{ value: "mieszany", label: "Mieszane" },
			{ value: "dłużny", label: "Dłużne" },
			{ value: "alternatywny", label: "Alternatywne" },
		],
		defaultCategory: "akcyjny",
		subtitle: (row) => row.asOf,
	},
	coingecko: {
		source: "coingecko",
		columns: [
			percent("24h", "change_24h"),
			percent("7d", "change_7d"),
			percent("30d", "change_30d"),
			percent("200d", "change_200d"),
			percent("1y", "change_1y"),
			price("Price (PLN)"),
		],
		defaultSort: "1y",
		periods: ["1y", "200d", "30d", "7d", "24h"],
		defaultPeriod: "1y",
		thresholds: [10, 20, 30, 40, 50],
		defaultThreshold: 50,
	},
	coinpaprika: {
		source: "coinpaprika",
		columns: [
			percent("1h", "change_1h"),
			percent("24h", "change_24h"),
			percent("7d", "change_7d"),
			price("Price (PLN)"),
		],
		defaultSort: "7d",
		periods: ["7d", "24h", "1h"],
		defaultPeriod: "7d",
		thresholds: cryptoThresholds,
		defaultThreshold: 10,
	},
	coinmarketcap: {
		source: "coinmarketcap",
		columns: [
			percent("7d", "change_7d"),
			percent("30d", "change_30d"),
			percent("60d", "change_60d"),
			percent("90d", "change_90d"),
			price("Price (USD)"),
		],
		defaultSort: "30d",
		periods: ["7d", "30d", "60d", "90d"],
		defaultPeriod: "30d",
		thresholds: cryptoThresholds,
	},
} as const satisfies Record<SourceId, TableConfig>

export const getTable = (source: SourceId): TableConfig => TABLES[source]
