import type { InstrumentKind } from "@fundstats/shared/sources"
import * as DateTime from "effect/DateTime"

/** A history point as the API returns it (newest first). */
interface ApiPoint {
	readonly capturedAt: string
	readonly asOf: string | null
	readonly value: number | null
}

export interface Point {
	/** Epoch milliseconds: the valuation date (UTC midnight) for funds, the capture time for crypto. */
	readonly t: number
	readonly v: number
}

const DAY = 86_400_000

/**
 * The longest silence a price line bridges; a longer one breaks it. Funds skip weekends and holidays;
 * crypto quotes are 6-hourly for a week, then thinned by the collector to one a day.
 */
export const GAPS = {
	fund: { line: 6 * DAY },
	crypto: { line: 2 * DAY },
} as const satisfies Record<InstrumentKind, { line: number }>

const epoch = (iso: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(iso))

/**
 * Oldest-first points with a value. Funds are placed by valuation date, one point per date (the API
 * lists the newest capture of a date first); live quotes by capture time.
 */
export const toPoints = (kind: InstrumentKind, points: ReadonlyArray<ApiPoint>): ReadonlyArray<Point> => {
	const out: Array<Point> = []
	const seen = new Set<string>()
	for (const point of points) {
		if (point.value === null) continue
		if (kind === "fund") {
			if (point.asOf === null || seen.has(point.asOf)) continue
			seen.add(point.asOf)
			out.push({ t: epoch(`${point.asOf}T00:00:00Z`), v: point.value })
		} else {
			out.push({ t: epoch(point.capturedAt), v: point.value })
		}
	}
	return out.sort((a, b) => a.t - b.t)
}

const RANGES = [
	{ id: "1m", label: "1M", days: 30 },
	{ id: "3m", label: "3M", days: 91 },
	{ id: "6m", label: "6M", days: 182 },
	{ id: "1y", label: "1Y", days: 365 },
	{ id: "3y", label: "3Y", days: 3 * 365 },
	{ id: "5y", label: "5Y", days: 5 * 365 },
	{ id: "max", label: "MAX", days: Infinity },
] as const

export type RangeId = (typeof RANGES)[number]["id"]

export const isRangeId = (value: unknown): value is RangeId => RANGES.some((r) => r.id === value)

/**
 * Ranges the plotted points span (two days of slack for weekends) with at least two points inside
 * the window, plus max.
 */
export const coveredRanges = (points: ReadonlyArray<Point>) => {
	const first = points[0]
	const last = points.at(-1)
	const span = first && last ? (last.t - first.t) / DAY : 0
	return RANGES.filter(
		(range) =>
			range.id === "max" || (span >= range.days - 2 && clip(points, rangeWindow(range.id, points)).length >= 2),
	)
}

export const pickRange = (points: ReadonlyArray<Point>, wanted: string | undefined): RangeId => {
	const covered = coveredRanges(points)
	if (wanted && covered.some((r) => r.id === wanted)) return wanted as RangeId
	return covered.some((r) => r.id === "1y") ? "1y" : "max"
}

/**
 * The time window a range shows: up to `days` back from the newest point, never before the first.
 */
export const rangeWindow = (range: RangeId, points: ReadonlyArray<Point>) => {
	const days = RANGES.find((r) => r.id === range)!.days
	const end = points.at(-1)?.t ?? 0
	return { start: Math.max(end - days * DAY, points[0]?.t ?? end), end }
}

export const clip = (points: ReadonlyArray<Point>, frame: { readonly start: number; readonly end: number }) =>
	points.filter((p) => p.t >= frame.start && p.t <= frame.end)
