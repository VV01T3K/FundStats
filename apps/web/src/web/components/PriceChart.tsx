import * as DateTime from "effect/DateTime"
import { type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
	epochToIso,
	formatCapturedFull,
	formatDate,
	formatEpochDay,
	formatFixed,
	formatPercent,
	formatPrice,
} from "../format.ts"
import { niceTicks, type Point, timeTicks, type TimeUnit } from "../history.ts"

export interface ChartSeries {
	readonly id: string
	readonly name: string
	/** A CSS color, e.g. `var(--series-1)`. */
	readonly color: string
	readonly points: ReadonlyArray<Point>
}

const MARGIN = { top: 10, right: 64, bottom: 26, left: 2 }

const monthFormat = new Intl.DateTimeFormat("pl-PL", { month: "short", timeZone: "UTC" })
const hourFormat = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" })
const isoDay = (t: number) => DateTime.formatIsoDateUtc(DateTime.makeUnsafe(t))

const tickLabel = (t: number, unit: TimeUnit) => {
	switch (unit) {
		case "hour":
			return hourFormat.format(t)
		case "day":
			return formatDate(isoDay(t)).slice(0, 5)
		case "month": {
			const month = monthFormat.format(t).replace(".", "")
			return month === "sty" ? `${month} ${isoDay(t).slice(0, 4)}` : month
		}
		case "year":
			return isoDay(t).slice(0, 4)
	}
}

/** Index of the point nearest to `t` in an oldest-first series. */
const nearest = (points: ReadonlyArray<Point>, t: number) => {
	let lo = 0
	let hi = points.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (points[mid]!.t < t) lo = mid + 1
		else hi = mid
	}
	const before = points[lo - 1]
	return before && Math.abs(before.t - t) < Math.abs(points[lo]!.t - t) ? lo - 1 : lo
}

/**
 * One price line, or several rebased to 100 for comparison. Hand-drawn SVG: hairline grid, labels on
 * the right, a crosshair and tooltip that follow the pointer.
 */
export function PriceChart({
	series,
	mode,
	unit,
	time,
	height = 300,
}: {
	readonly series: ReadonlyArray<ChartSeries>
	readonly mode: "price" | "index"
	/** Currency of the price axis. */
	readonly unit: string
	/** Funds are placed by valuation date, live quotes by capture time. */
	readonly time: "date" | "instant"
	readonly height?: number
}) {
	const wrapper = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(880)
	const [hoverT, setHoverT] = useState<number | null>(null)

	useLayoutEffect(() => {
		const element = wrapper.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)))
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	const plotW = width - MARGIN.left - MARGIN.right
	const plotH = height - MARGIN.top - MARGIN.bottom

	const scales = useMemo(() => {
		const all = series.flatMap((s) => s.points)
		const t0 = Math.min(...all.map((p) => p.t))
		const t1 = Math.max(...all.map((p) => p.t))
		const v0 = Math.min(...all.map((p) => p.v))
		const v1 = Math.max(...all.map((p) => p.v))
		const pad = (v1 - v0) * 0.06 || Math.abs(v0) * 0.01 || 1
		const lo = v0 - pad
		const hi = v1 + pad
		const y = niceTicks(lo, hi, plotH < 220 ? 4 : 5)
		const yTicks = y.ticks.filter((tick) => tick >= lo && tick <= hi)
		const span = t1 - t0 || 1
		const x = (t: number) => MARGIN.left + ((t - t0) / span) * plotW
		const yOf = (v: number) => MARGIN.top + (1 - (v - lo) / (hi - lo || 1)) * plotH
		const xTicks = timeTicks(t0, t1, Math.max(2, Math.floor(plotW / 90)))
		return { t0, t1, span, x, y: yOf, yTicks, yStep: y.step, xTicks }
	}, [series, plotW, plotH])

	const tickDecimals = scales.yStep >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(scales.yStep)))
	const formatWhen = (t: number) => (time === "date" ? formatEpochDay(t) : formatCapturedFull(epochToIso(t)))

	const main = series[0]
	const hoverIndex = main && hoverT !== null ? nearest(main.points, hoverT) : null
	const hoverPoint = main && hoverIndex !== null ? main.points[hoverIndex] : undefined

	const onPointer = (event: PointerEvent<SVGRectElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const ratio = (event.clientX - rect.left) / rect.width
		setHoverT(scales.t0 + Math.max(0, Math.min(1, ratio)) * scales.span)
	}

	const path = (points: ReadonlyArray<Point>) =>
		points.map((p, i) => `${i === 0 ? "M" : "L"}${scales.x(p.t).toFixed(1)},${scales.y(p.v).toFixed(1)}`).join("")

	const tooltipLeft = hoverPoint ? scales.x(hoverPoint.t) : 0
	const flip = tooltipLeft > width - 220

	return (
		<div ref={wrapper} className="relative w-full select-none" style={{ height }}>
			<svg
				width={width}
				height={height}
				role="img"
				aria-label={
					main && main.points.length > 0
						? `Wykres ${mode === "index" ? "indeksu" : "ceny"} od ${formatWhen(scales.t0)} do ${formatWhen(scales.t1)}`
						: "Wykres"
				}
				className="block overflow-visible"
			>
				{scales.yTicks.map((tick) => (
					<g key={tick}>
						<line
							x1={MARGIN.left}
							x2={MARGIN.left + plotW}
							y1={scales.y(tick)}
							y2={scales.y(tick)}
							stroke={mode === "index" && tick === 100 ? "var(--rule-strong)" : "var(--rule)"}
							strokeWidth={1}
							shapeRendering="crispEdges"
						/>
						<text
							x={MARGIN.left + plotW + 8}
							y={scales.y(tick)}
							dy="0.32em"
							className="num fill-[var(--muted)] text-[11px]"
						>
							{formatFixed(tick, tickDecimals)}
						</text>
					</g>
				))}
				<line
					x1={MARGIN.left}
					x2={MARGIN.left + plotW}
					y1={MARGIN.top + plotH}
					y2={MARGIN.top + plotH}
					stroke="var(--rule-strong)"
					shapeRendering="crispEdges"
				/>
				{scales.xTicks.ticks.map((tick) => (
					<g key={tick}>
						<line
							x1={scales.x(tick)}
							x2={scales.x(tick)}
							y1={MARGIN.top + plotH}
							y2={MARGIN.top + plotH + 4}
							stroke="var(--rule-strong)"
							shapeRendering="crispEdges"
						/>
						<text
							x={scales.x(tick)}
							y={MARGIN.top + plotH + 17}
							textAnchor="middle"
							className="num fill-[var(--muted)] text-[11px]"
						>
							{tickLabel(tick, scales.xTicks.unit)}
						</text>
					</g>
				))}
				{[...series].reverse().map((s, i) => {
					const isMain = i === series.length - 1
					if (s.points.length === 1) {
						const only = s.points[0]!
						return <circle key={s.id} cx={scales.x(only.t)} cy={scales.y(only.v)} r={4} fill={s.color} />
					}
					return (
						<path
							key={s.id}
							d={path(s.points)}
							fill="none"
							stroke={s.color}
							strokeWidth={isMain ? 2 : 1.5}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
					)
				})}
				{hoverPoint ? (
					<g pointerEvents="none">
						<line
							x1={scales.x(hoverPoint.t)}
							x2={scales.x(hoverPoint.t)}
							y1={MARGIN.top}
							y2={MARGIN.top + plotH}
							stroke="var(--muted)"
							strokeDasharray="2 3"
							shapeRendering="crispEdges"
						/>
						{series.map((s) => {
							const p = s.points[nearest(s.points, hoverPoint.t)]
							if (!p) return null
							return (
								<circle
									key={s.id}
									cx={scales.x(p.t)}
									cy={scales.y(p.v)}
									r={4}
									fill={s.color}
									stroke="var(--bg)"
									strokeWidth={2}
								/>
							)
						})}
					</g>
				) : null}
				<rect
					x={MARGIN.left}
					y={MARGIN.top}
					width={plotW}
					height={plotH}
					fill="transparent"
					style={{ touchAction: "pan-y" }}
					onPointerMove={onPointer}
					onPointerDown={onPointer}
					onPointerLeave={() => setHoverT(null)}
				/>
			</svg>
			{hoverPoint ? (
				<div
					className="bg-bg pointer-events-none absolute top-1 z-10 min-w-44 rounded-md border px-2.5 py-1.5 text-xs shadow-[0_6px_16px_-6px_oklch(0_0_0/0.3)]"
					style={flip ? { right: width - tooltipLeft + 10 } : { left: tooltipLeft + 10 }}
				>
					<div className="num text-muted mb-1">{formatWhen(hoverPoint.t)}</div>
					{series.map((s) => {
						const p = s.points[nearest(s.points, hoverPoint.t)]
						if (!p) return null
						return (
							<div key={s.id} className="flex items-center gap-2 py-px">
								<span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
								<span className="max-w-36 min-w-0 flex-1 truncate">{s.name}</span>
								<span className="num font-medium">
									{mode === "index" ? formatPercent(p.v - 100) : `${formatPrice(p.v)} ${unit}`}
								</span>
							</div>
						)
					})}
				</div>
			) : null}
		</div>
	)
}
