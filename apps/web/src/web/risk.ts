import type { SnapshotRow } from "@fundstats/shared/api"

import { fundRisk, fundRiskName } from "./tables.ts"

/**
 * mBank's own risk scale, not the SRI 1–7: numbered levels with names ("bardzo niskie" … "wysokie").
 * Which levels exist, and what they are called, is read from the rows rather than assumed.
 */
export interface RiskLevel {
	readonly level: number
	readonly name: string
	/** For the narrow column: "bardzo niskie" → "b. niskie". */
	readonly short: string
	readonly count: number
}

const shortRiskName = (name: string) => name.replace(/^bardzo\s+/i, "b. ")

/** The levels present in `rows`, lowest first, each with the name its funds carry and their count. */
export const riskScale = (rows: ReadonlyArray<SnapshotRow>): ReadonlyArray<RiskLevel> => {
	const levels = new Map<number, { name: string | null; count: number }>()
	for (const row of rows) {
		const level = fundRisk(row)
		if (level === null) continue
		const entry = levels.get(level) ?? { name: null, count: 0 }
		levels.set(level, { name: entry.name ?? fundRiskName(row), count: entry.count + 1 })
	}
	return [...levels]
		.sort(([a], [b]) => a - b)
		.map(([level, { name, count }]) => {
			const label = name ?? `poziom ${level}`
			return { level, name: label, short: shortRiskName(label), count }
		})
}
