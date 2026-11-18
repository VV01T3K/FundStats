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
const HOUR = 3_600_000

/**
 * How far apart points may be. `hover`: a series shows a value under the pointer only if it has one
 * this close. `line`: a longer silence breaks the line. Funds skip weekends and holidays; crypto
 * quotes are 6-hourly for a week, then thinned by the collector to one a day.
 */
export const GAPS = {
	fund: { hover: 4 * DAY, line: 6 * DAY },
	crypto: { hover: 27 * HOUR, line: 2 * DAY },
} as const satisfies Record<InstrumentKind, { hover: number; line: number }>

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
	{ id: "1m", label: "1m", days: 30 },
	{ id: "3m", label: "3m", days: 91 },
	{ id: "6m", label: "6m", days: 182 },
	{ id: "1y", label: "1r", days: 365 },
	{ id: "3y", label: "3l", days: 3 * 365 },
	{ id: "5y", label: "5l", days: 5 * 365 },
	{ id: "max", label: "max", days: Infinity },
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
 * The time window a range shows: up to `days` back from the main series' newest point, never before
 * its first. Every series of a chart is cut to it, so a pin can neither widen nor extend the range.
 */
export const rangeWindow = (range: RangeId, points: ReadonlyArray<Point>) => {
	const days = RANGES.find((r) => r.id === range)!.days
	const end = points.at(-1)?.t ?? 0
	return { start: Math.max(end - days * DAY, points[0]?.t ?? end), end }
}

export const clip = (points: ReadonlyArray<Point>, frame: { readonly start: number; readonly end: number }) =>
	points.filter((p) => p.t >= frame.start && p.t <= frame.end)

/** A series inside the window as percent change from its own first quote there (0 at that quote). */
export const changeWithin = (points: ReadonlyArray<Point>, frame: { readonly start: number; readonly end: number }) => {
	const inside = clip(points, frame)
	const first = inside[0]
	return first ? inside.map((p) => ({ t: p.t, v: (p.v / first.v - 1) * 100 })) : []
}

/** The point nearest to `t` in an oldest-first series, if one lies within `maxGap`. */
export const nearestWithin = (points: ReadonlyArray<Point>, t: number, maxGap: number) => {
	if (points.length === 0) return undefined
	let lo = 0
	let hi = points.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (points[mid]!.t < t) lo = mid + 1
		else hi = mid
	}
	const before = points[lo - 1]
	const best = before && Math.abs(before.t - t) < Math.abs(points[lo]!.t - t) ? before : points[lo]!
	return Math.abs(best.t - t) <= maxGap ? best : undefined
}

/** Runs of points with no silence longer than `maxGap`, drawn as separate lines. */
export const splitAtGaps = (points: ReadonlyArray<Point>, maxGap: number) => {
	const runs: Array<Array<Point>> = []
	for (const point of points) {
		const run = runs.at(-1)
		const last = run?.at(-1)
		if (run && last && point.t - last.t <= maxGap) run.push(point)
		else runs.push([point])
	}
	return runs
}

/** Round tick values (1, 2, 2.5, 5 × 10ⁿ) covering [min, max]. */
export const niceTicks = (min: number, max: number, count = 5): { ticks: Array<number>; step: number } => {
	if (min === max) {
		const pad = Math.abs(min) * 0.01 || 1
		return niceTicks(min - pad, max + pad, count)
	}
	const raw = (max - min) / count
	const magnitude = 10 ** Math.floor(Math.log10(raw))
	const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude
	const ticks: Array<number> = []
	for (let value = Math.floor(min / step) * step; value <= max + step * 0.5; value += step) {
		ticks.push(Math.round(value / step) * step)
	}
	return { ticks, step }
}

export type TimeUnit = "hour" | "day" | "month" | "year"

/** Tick times between `start` and `end` (ms), aligned to UTC hours, days, months or years. */
export const timeTicks = (start: number, end: number, maxTicks: number): { unit: TimeUnit; ticks: Array<number> } => {
	const spanDays = (end - start) / DAY
	const candidates: Array<{ unit: TimeUnit; every: number }> = [
		{ unit: "hour", every: 6 },
		{ unit: "hour", every: 12 },
		{ unit: "day", every: 1 },
		{ unit: "day", every: 2 },
		{ unit: "day", every: 7 },
		{ unit: "day", every: 14 },
		{ unit: "month", every: 1 },
		{ unit: "month", every: 2 },
		{ unit: "month", every: 3 },
		{ unit: "month", every: 6 },
		{ unit: "year", every: 1 },
		{ unit: "year", every: 2 },
		{ unit: "year", every: 5 },
	]
	const approxDays = { hour: 1 / 24, day: 1, month: 30.4, year: 365 }
	const pick = candidates.find((c) => spanDays / (approxDays[c.unit] * c.every) <= maxTicks) ?? candidates.at(-1)!
	const plural = { hour: "hours", day: "days", month: "months", year: "years" } as const
	const next = (d: DateTime.Utc, by: number) => DateTime.add(d, { [plural[pick.unit]]: by })
	let d = DateTime.startOf(DateTime.makeUnsafe(start), pick.unit)
	while (DateTime.toEpochMillis(d) < start) d = next(d, 1)
	const part = pick.unit === "hour" ? "hour" : pick.unit === "month" ? "month" : null
	if (part) while ((DateTime.getPartUtc(d, part) - (part === "month" ? 1 : 0)) % pick.every !== 0) d = next(d, 1)
	const ticks: Array<number> = []
	while (DateTime.toEpochMillis(d) <= end) {
		ticks.push(DateTime.toEpochMillis(d))
		d = next(d, pick.every)
	}
	return { unit: pick.unit, ticks }
}
