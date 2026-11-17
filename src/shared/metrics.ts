/**
 * Metric names stored in `snapshots.metrics`. Every source maps its upstream
 * fields onto these names, so the same period means the same key everywhere.
 *
 * - `change_<period>` is a percentage change over that period (5 = +5 %).
 * - Fund periods use calendar units (1m, 3m, ...); crypto uses day counts as the
 *   upstreams report them (24h, 7d, 30d, ...). They are not merged because a
 *   calendar month and 30 days are not the same window.
 * - `rank` is the upstream's market rank where it has one.
 */
export const METRICS = {
	change_1d: "Change 1 day",
	change_1m: "Change 1 month",
	change_3m: "Change 3 months",
	change_6m: "Change 6 months",
	change_1y: "Change 1 year",
	change_3y: "Change 3 years",
	change_5y: "Change 5 years",
	change_max: "Change since launch",
	change_1h: "Change 1 hour",
	change_24h: "Change 24 hours",
	change_7d: "Change 7 days",
	change_30d: "Change 30 days",
	change_60d: "Change 60 days",
	change_90d: "Change 90 days",
	change_200d: "Change 200 days",
	rank: "Market rank",
} as const

export type MetricName = keyof typeof METRICS

/** What a snapshot stores: named numeric values; a missing key means "no data". */
export type Metrics = Partial<Record<MetricName, number>>

/** Builds a `Metrics` object, dropping null, undefined and non-finite values. */
export const metrics = (values: Partial<Record<MetricName, number | null | undefined>>): Metrics => {
	const out: Metrics = {}
	for (const [key, value] of Object.entries(values)) {
		if (typeof value === "number" && Number.isFinite(value)) {
			out[key as MetricName] = value
		}
	}
	return out
}

/**
 * Derived values are computed from stored metrics when they are read, never
 * stored, so changing a formula needs no data migration.
 */
export const MOMENTUM_WEIGHTS = [
	["change_1m", 4],
	["change_3m", 3],
	["change_6m", 2],
	["change_1y", 1],
] as const satisfies ReadonlyArray<readonly [MetricName, number]>

/**
 * Weighted momentum: (4·1m + 3·3m + 2·6m + 1·1y) / 10. Recent periods count
 * more. Returns null when any of the four periods is missing.
 */
export const momentum = (m: Metrics): number | null => {
	let sum = 0
	let weights = 0
	for (const [key, weight] of MOMENTUM_WEIGHTS) {
		const value = m[key]
		if (value === undefined) return null
		sum += weight * value
		weights += weight
	}
	return sum / weights
}

export const MOMENTUM_FORMULA = "(4×1m + 3×3m + 2×6m + 1×1y) / 10"
