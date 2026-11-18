import type { SnapshotRow, SourceStatus } from "@fundstats/shared/api"

import { formatCaptured, formatCapturedFull, formatDate } from "./format.ts"

export interface Freshness {
	readonly warn: boolean
	/** The quiet line: `wycena 17.11.2026 · pobrano 18.11, 06:02`. */
	readonly line: string
	/** Tooltip: the full timestamp, or why the data is out of date. */
	readonly detail: string
}

/**
 * The valuation date most rows share (the newer one on a tie); null for live quotes. Funds valued
 * abroad lag a day or two, so the newest date would mark most rows as exceptions.
 */
export const tableAsOf = (rows: ReadonlyArray<SnapshotRow>) => {
	const counts = new Map<string, number>()
	for (const row of rows) if (row.asOf) counts.set(row.asOf, (counts.get(row.asOf) ?? 0) + 1)
	let best: string | null = null
	for (const [date, count] of counts) {
		const bestCount = best === null ? 0 : counts.get(best)!
		if (count > bestCount || (count === bestCount && best !== null && date > best)) best = date
	}
	return best
}

const collectedAt = (status: SourceStatus) => status.lastSuccess?.finishedAt ?? status.lastSuccess?.startedAt ?? null

export const freshness = (status: SourceStatus, asOf: string | null): Freshness => {
	const at = collectedAt(status)
	const failed = status.lastRun?.status === "failed"
	const parts = [asOf ? `wycena ${formatDate(asOf)}` : null, at ? `pobrano ${formatCaptured(at)}` : null].filter(
		(part) => part !== null,
	)
	if (at === null) {
		return {
			warn: true,
			line: "brak danych",
			detail:
				failed && status.lastRun?.error
					? `Pobranie nie powiodło się: ${status.lastRun.error}`
					: "Jeszcze nic nie pobrano.",
		}
	}
	if (status.stale) {
		return {
			warn: true,
			line: ["nieaktualne", ...parts].join(" · "),
			detail: failed
				? `Ostatnie pobranie nie powiodło się${status.lastRun?.error ? `: ${status.lastRun.error}` : "."} Dane z ${formatCapturedFull(at)}.`
				: `Ostatnie udane pobranie: ${formatCapturedFull(at)}. Kolektor spóźnia się z kolejnym.`,
		}
	}
	return { warn: false, line: parts.join(" · "), detail: `Pobrano ${formatCapturedFull(at)} (czas warszawski)` }
}
