import type { SnapshotRow, SourceStatus } from "@fundstats/shared/api"

import { formatInterval, formatStamp } from "./format.ts"

/**
 * `live`: fresh crypto quotes. `cached`: fresh fund valuations, which change once a day however often
 * they are collected. `stale`: the last run failed or the next one is overdue. `empty`: never collected.
 */
export type SourceState = "live" | "cached" | "stale" | "empty"

export const sourceState = (status: SourceStatus): SourceState =>
	status.lastSuccess === null ? "empty" : status.stale ? "stale" : status.kind === "fund" ? "cached" : "live"

/** When the last successful run finished. */
export const collectedAt = (status: SourceStatus) =>
	status.lastSuccess?.finishedAt ?? status.lastSuccess?.startedAt ?? null

/** `LIVE`, `CACHED 06H`, `STALE`, `NO DATA`. */
export const stateLabel = (status: SourceStatus) => {
	const state = sourceState(status)
	if (state === "cached") return `CACHED ${formatInterval(status.intervalSeconds).toUpperCase().padStart(3, "0")}`
	return { live: "LIVE", stale: "STALE", empty: "NO DATA" }[state]
}

/** The tooltip: when the data is from and, if it is out of date, why. */
export const stateDetail = (status: SourceStatus) => {
	const at = collectedAt(status)
	const failed = status.lastRun?.status === "failed"
	const error = failed && status.lastRun?.error ? `: ${status.lastRun.error}` : "."
	if (at === null) return failed ? `Collection failed${error}` : "Nothing collected yet."
	const when = `Collected ${formatStamp(at)}.`
	if (!status.stale) return `${when} Refreshed every ${formatInterval(status.intervalSeconds)}.`
	return failed ? `The last collection failed${error} ${when}` : `${when} The next collection is overdue.`
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
