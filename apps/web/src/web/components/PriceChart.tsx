import type { InstrumentKind } from "@fundstats/shared/sources"
import { crosshair, defineChart, lineY } from "@tanstack/charts"
import { Chart } from "@tanstack/charts/react"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { scaleUtc } from "@tanstack/charts/scales/time"
import { tooltip } from "@tanstack/charts/tooltip"
import * as DateTime from "effect/DateTime"
import { useMemo } from "react"

import { epochToIso, formatDate, formatEpochDay, formatInteger, formatPrice, formatStamp } from "../format.ts"
import { GAPS, type Point } from "../history.ts"

const DAY = 86_400_000

const whenFor = (kind: InstrumentKind) => (t: number) =>
	kind === "fund" ? formatEpochDay(t) : formatStamp(epochToIso(t))

/** Axis prices: whole numbers from 1 000 up, where the grosze are noise at axis scale. */
const tickPrice = (value: number) => (Math.abs(value) >= 1000 ? formatInteger(value) : formatPrice(value))

const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const isoDay = (date: Date) => DateTime.formatIsoDateUtc(DateTime.fromDateUnsafe(date))

/** Month ticks read `NOV`, with the year on January; shorter windows tick by day, `17.11`. */
const tickLabel = (spanDays: number) => (date: Date) => {
	if (spanDays <= 62) return formatDate(isoDay(date)).slice(0, 5)
	const day = isoDay(date)
	return day.slice(5, 7) === "01" ? day.slice(0, 4) : month.format(date).toUpperCase()
}

interface Row {
	readonly date: Date
	/** null breaks the line: no quote for longer than the source's usual silence. */
	readonly price: number | null
	readonly t: number
}

/** The points as chart rows, with a null row wherever a gap is longer than the line may bridge. */
const toRows = (points: ReadonlyArray<Point>, maxGap: number) => {
	const rows: Array<Row> = []
	let previous: Point | undefined
	for (const point of points) {
		if (previous && point.t - previous.t > maxGap) {
			const t = previous.t + 1
			rows.push({ date: DateTime.toDateUtc(DateTime.makeUnsafe(t)), price: null, t })
		}
		rows.push({ date: DateTime.toDateUtc(DateTime.makeUnsafe(point.t)), price: point.v, t: point.t })
		previous = point
	}
	return rows
}

/**
 * One instrument's price over the selected window, drawn by TanStack Charts: pointer and keyboard
 * inspection (arrows, Home/End, Enter pins), a crosshair and a tooltip announced through a status region.
 */
export function PriceChart({
	points,
	currency,
	kind,
	height = 320,
}: {
	/** Oldest first, already cut to the window; at least two. */
	readonly points: ReadonlyArray<Point>
	readonly currency: string
	/** Funds are placed by valuation date, live quotes by capture time. */
	readonly kind: InstrumentKind
	readonly height?: number
}) {
	const first = points[0]!
	const last = points.at(-1)!

	const when = whenFor(kind)
	const definition = useMemo(() => {
		const from = points[0]!
		const to = points.at(-1)!
		const label = whenFor(kind)
		return defineChart({
			marks: [
				lineY(toRows(points, GAPS[kind].line), {
					x: "date",
					y: "price",
					key: "t",
					stroke: to.v >= from.v ? "var(--up)" : "var(--down)",
					strokeWidth: 1.5,
				}),
				crosshair({ x: true, y: false, strokeDasharray: "2 3" }),
			],
			scales: {
				x: {
					scale: scaleUtc,
					axis: {
						ticks: { spacing: 96, format: tickLabel((to.t - from.t) / DAY) },
						tickLabels: { fontSize: 10 },
					},
				},
				y: {
					scale: scaleLinear,
					nice: true,
					grid: true,
					side: "right",
					axis: { line: false, ticks: { size: 0, format: tickPrice }, tickLabels: { fontSize: 10 } },
				},
			},
			focus: "nearest-x",
			maxFocusDistance: Number.POSITIVE_INFINITY,
			focusRing: { radius: 3.5, strokeWidth: 2, fill: "var(--bg)" },
			tooltip: {
				use: tooltip,
				format: (point) =>
					`${label(point.datum.t)}\n${point.datum.price === null ? "–" : formatPrice(point.datum.price)} ${currency}`,
			},
		})
	}, [points, kind, currency])

	return (
		<div className="price-chart text-dim">
			<Chart
				definition={definition}
				height={height}
				initialWidth={1200}
				ariaLabel={`Price in ${currency}`}
				ariaDescription={`From ${when(first.t)} to ${when(last.t)}: ${formatPrice(first.v)} to ${formatPrice(last.v)} ${currency}. Arrow keys move between quotes.`}
			/>
		</div>
	)
}
