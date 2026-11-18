import type { InstrumentKind } from "@fundstats/shared/sources"

import { roundForDisplay } from "./format.ts"

/**
 * The value at which a column's wash reaches full strength, in its own unit (percent). Fixed per
 * period rather than taken from the visible rows, so filtering or re-sorting never repaints a cell.
 */
const HEAT_CAPS = {
	fund: {
		"1d": 2,
		"1m": 8,
		"3m": 15,
		"6m": 20,
		"1y": 30,
		"3y": 60,
		"5y": 80,
		max: 150,
		mom: 15,
	},
	crypto: {
		"1h": 3,
		"24h": 8,
		"7d": 20,
		"30d": 40,
		"60d": 60,
		"90d": 60,
		"200d": 80,
		"1y": 80,
	},
} as const satisfies Record<InstrumentKind, Record<string, number>>

export const heatCap = (kind: InstrumentKind, columnId: string): number | null => {
	const caps: Record<string, number> = HEAT_CAPS[kind]
	return caps[columnId] ?? null
}

export type HeatStep = -3 | -2 | -1 | 0 | 1 | 2 | 3

/** Three steps each side of zero; zero (as printed) and missing values stay neutral. */
export const heatStep = (value: number | null, cap: number): HeatStep => {
	if (value === null || !Number.isFinite(value)) return 0
	const shown = roundForDisplay(value)
	if (shown === 0) return 0
	const level = Math.min(3, Math.ceil((Math.abs(shown) / cap) * 3))
	return (Math.sign(shown) * level) as HeatStep
}
