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

/** The ranges the data actually spans (allowing two days of slack for weekends), plus max. */
export const coveredRanges = (points: ReadonlyArray<Point>) => {
	const first = points[0]
	const last = points.at(-1)
	const span = first && last ? (last.t - first.t) / DAY : 0
	return RANGES.filter((range) => range.id === "max" || span >= range.days - 2)
}

export const pickRange = (points: ReadonlyArray<Point>, wanted: string | undefined): RangeId => {
	const covered = coveredRanges(points)
	if (wanted && covered.some((r) => r.id === wanted)) return wanted as RangeId
	return covered.some((r) => r.id === "1y") ? "1y" : "max"
}

export const sliceRange = (points: ReadonlyArray<Point>, range: RangeId, end: number) => {
	const days = RANGES.find((r) => r.id === range)!.days
	if (!Number.isFinite(days)) return points
	const start = end - days * DAY
	return points.filter((p) => p.t >= start)
}

/** The value at or just before `t`; the first point when `t` precedes them all. */
const valueAt = (points: ReadonlyArray<Point>, t: number) => {
	let found = points[0]
	for (const point of points) {
		if (point.t > t) break
		found = point
	}
	return found?.v ?? null
}

/**
 * Rebases every series to 100 at the first date all of them have data, dropping what comes before.
 * Returns null when the series share no dates.
 */
export const rebase = (series: ReadonlyArray<ReadonlyArray<Point>>) => {
	const starts = series.map((points) => points[0]?.t ?? Infinity)
	const ends = series.map((points) => points.at(-1)?.t ?? -Infinity)
	const base = Math.max(...starts)
	if (!Number.isFinite(base) || base > Math.min(...ends)) return null
	const rebased = series.map((points) => {
		const at = valueAt(points, base)
		if (at === null || at === 0) return []
		return points.filter((p) => p.t >= base).map((p) => ({ t: p.t, v: (p.v / at) * 100 }))
	})
	return { base, series: rebased }
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
