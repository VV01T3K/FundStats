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
	/** When the value was observed, if not at `t` (a rebase anchor carried from an earlier quote). */
	readonly observed?: number
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
			range.id === "max" || (span >= range.days - 2 && clip(points, rangeWindow(range.id, last?.t ?? 0)).length >= 2),
	)
}

export const pickRange = (points: ReadonlyArray<Point>, wanted: string | undefined): RangeId => {
	const covered = coveredRanges(points)
	if (wanted && covered.some((r) => r.id === wanted)) return wanted as RangeId
	return covered.some((r) => r.id === "1y") ? "1y" : "max"
}

/** The time window a range shows, ending at `end` (the main series' newest point). */
export const rangeWindow = (range: RangeId, end: number) => {
	const days = RANGES.find((r) => r.id === range)!.days
	return { start: Number.isFinite(days) ? end - days * DAY : -Infinity, end }
}

/** Points inside the window, both ends included; every series of a chart is cut to the same one. */
export const clip = (points: ReadonlyArray<Point>, frame: { readonly start: number; readonly end: number }) =>
	points.filter((p) => p.t >= frame.start && p.t <= frame.end)

/** The last point at or before `t`. */
const pointAt = (points: ReadonlyArray<Point>, t: number) => {
	let found: Point | undefined
	for (const point of points) {
		if (point.t > t) break
		found = point
	}
	return found
}

/** Why a compared series is not drawn. */
export type Exclusion = "empty" | "disjoint"

/**
 * Rebases the main series and the compared ones to 100 at the first time from the latest start on
 * where every series has a quote no older than `maxGap`, so no line is anchored on a stale value.
 * Series with no points, or no such time, are left out and reported by index. Each kept series
 * starts with a 100 at `base` that records when its anchor quote was taken.
 */
export const compare = (main: ReadonlyArray<Point>, others: ReadonlyArray<ReadonlyArray<Point>>, maxGap: number) => {
	const excluded = new Map<number, Exclusion>()
	others.forEach((points, i) => {
		if (points.length === 0) excluded.set(i, "empty")
	})
	const recentAt = (points: ReadonlyArray<Point>, t: number) => {
		const anchor = pointAt(points, t)
		return anchor && t - anchor.t <= maxGap ? anchor : undefined
	}
	const sharedBase = (group: ReadonlyArray<ReadonlyArray<Point>>) => {
		if (group.some((points) => points.length === 0)) return null
		const start = Math.max(...group.map((points) => points[0]!.t))
		const end = Math.min(...group.map((points) => points.at(-1)!.t))
		const candidates = [start, ...main.filter((p) => p.t > start && p.t <= end).map((p) => p.t)]
		return candidates.find((t) => t <= end && group.every((points) => recentAt(points, t))) ?? null
	}
	others.forEach((points, i) => {
		if (!excluded.has(i) && sharedBase([main, points]) === null) excluded.set(i, "disjoint")
	})
	let active = others.map((_, i) => i).filter((i) => !excluded.has(i))
	const groupBase = () => (active.length > 0 ? sharedBase([main, ...active.map((i) => others[i]!)]) : null)
	let base = groupBase()
	// Each pair overlaps but the group does not: leave out the latest starter until it does.
	while (base === null && active.length > 0) {
		const latest = active.reduce((a, b) => (others[b]![0]!.t > others[a]![0]!.t ? b : a))
		excluded.set(latest, "disjoint")
		active = active.filter((i) => i !== latest)
		base = groupBase()
	}
	if (base === null) return { base: null, main, others: [], excluded }
	const at = base
	const anchored = (points: ReadonlyArray<Point>): ReadonlyArray<Point> => {
		const anchor = recentAt(points, at)!
		const head: Point = anchor.t === at ? { t: at, v: 100 } : { t: at, v: 100, observed: anchor.t }
		return [head, ...points.filter((p) => p.t > at).map((p) => ({ t: p.t, v: (p.v / anchor.v) * 100 }))]
	}
	return {
		base,
		main: anchored(main),
		others: active.map((index) => ({ index, points: anchored(others[index]!) })),
		excluded,
	}
}

/** The point nearest to `t` in an oldest-first series, if it was observed within `maxGap` of `t`. */
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
	return Math.abs((best.observed ?? best.t) - t) <= maxGap ? best : undefined
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
