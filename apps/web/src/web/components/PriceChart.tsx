import type { InstrumentKind } from "@fundstats/shared/sources"
import * as DateTime from "effect/DateTime"
import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
	epochToIso,
	formatCaptured,
	formatCapturedDate,
	formatCapturedFull,
	formatDate,
	formatEpochDay,
	formatFixed,
	formatPercent,
	formatPrice,
} from "../format.ts"
import { GAPS, nearestWithin, niceTicks, type Point, splitAtGaps, timeTicks, type TimeUnit } from "../history.ts"

export interface ChartSeries {
	readonly id: string
	readonly name: string
	/** A CSS color, e.g. `var(--series-1)`. */
	readonly color: string
	readonly points: ReadonlyArray<Point>
}

const MARGIN = { top: 10, right: 64, bottom: 40, left: 2 }

const monthFormat = new Intl.DateTimeFormat("pl-PL", { month: "short", timeZone: "UTC" })
const hourFormat = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" })
const isoDay = (t: number) => DateTime.formatIsoDateUtc(DateTime.makeUnsafe(t))

/** Tick labels; the second line names the year (the date, for hourly ticks) on the first tick and when it changes. */
const tickLabels = (ticks: ReadonlyArray<number>, unit: TimeUnit) => {
	const context = (t: number) => (unit === "hour" ? formatCapturedDate(epochToIso(t)) : isoDay(t).slice(0, 4))
	return ticks.map((t, i) => {
		const main =
			unit === "hour"
				? hourFormat.format(t)
				: unit === "day"
					? formatDate(isoDay(t)).slice(0, 5)
					: unit === "month"
						? monthFormat.format(t).replace(".", "")
						: isoDay(t).slice(0, 4)
		const changed = i === 0 || context(t) !== context(ticks[i - 1]!)
		return { main, sub: unit !== "year" && changed ? context(t) : null }
	})
}

/**
 * One price line, or several rebased to 100 for comparison. Hand-drawn SVG: hairline grid, labels on
 * the right, a crosshair and tooltip that follow the pointer or the arrow keys.
 */
export function PriceChart({
	series,
	mode,
	unit,
	kind,
	height = 300,
}: {
	readonly series: ReadonlyArray<ChartSeries>
	readonly mode: "price" | "index"
	/** Currency of the price axis. */
	readonly unit: string
	/** Funds are placed by valuation date, live quotes by capture time. */
	readonly kind: InstrumentKind
	readonly height?: number
}) {
	const wrapper = useRef<HTMLDivElement>(null)
	const tooltip = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(880)
	const [tooltipWidth, setTooltipWidth] = useState(200)
	const [active, setActive] = useState<number | null>(null)
	const gaps = GAPS[kind]

	useLayoutEffect(() => {
		const element = wrapper.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)))
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	useLayoutEffect(() => {
		const measured = tooltip.current?.offsetWidth
		if (measured && measured !== tooltipWidth) setTooltipWidth(measured)
	})

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
		return { t0, t1, span, x, y: yOf, yTicks, yStep: y.step, xTicks, xLabels: tickLabels(xTicks.ticks, xTicks.unit) }
	}, [series, plotW, plotH])

	const tickDecimals = scales.yStep >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(scales.yStep)))
	const formatWhen = (t: number) => (kind === "fund" ? formatEpochDay(t) : formatCapturedFull(epochToIso(t)))
	const formatShort = (t: number) => (kind === "fund" ? formatEpochDay(t) : formatCaptured(epochToIso(t)))

	const main = series[0]
	const mainPoints = main?.points ?? []
	const hovered = active === null ? undefined : mainPoints[Math.min(active, mainPoints.length - 1)]

	const onPointer = (event: PointerEvent<SVGRectElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
		const t = scales.t0 + ratio * scales.span
		const point = nearestWithin(mainPoints, t, Infinity)
		setActive(point ? mainPoints.indexOf(point) : null)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const last = mainPoints.length - 1
		const current = active ?? last
		const moves: Record<string, number> = {
			ArrowLeft: current - 1,
			ArrowRight: current + 1,
			PageUp: current - 10,
			PageDown: current + 10,
			Home: 0,
			End: last,
		}
		if (event.key === "Escape") return setActive(null)
		const next = moves[event.key]
		if (next === undefined) return
		event.preventDefault()
		setActive(Math.max(0, Math.min(last, next)))
	}

	const path = (points: ReadonlyArray<Point>) =>
		points.map((p, i) => `${i === 0 ? "M" : "L"}${scales.x(p.t).toFixed(1)},${scales.y(p.v).toFixed(1)}`).join("")

	const crosshairX = hovered ? scales.x(hovered.t) : 0
	const tooltipLeft = Math.max(
		0,
		Math.min(
			width - tooltipWidth,
			crosshairX + 12 + tooltipWidth <= width ? crosshairX + 12 : crosshairX - 12 - tooltipWidth,
		),
	)

	const rows = hovered
		? series.map((s) => {
				const point = s === main ? hovered : nearestWithin(s.points, hovered.t, gaps.hover)
				const observed = point ? (point.observed ?? point.t) : null
				return {
					series: s,
					point,
					ownDate: observed !== null && formatShort(observed) !== formatShort(hovered.t) ? formatShort(observed) : null,
				}
			})
		: []

	return (
		<div
			ref={wrapper}
			tabIndex={0}
			role="group"
			aria-roledescription="wykres"
			aria-label={
				mainPoints.length > 0
					? `Wykres ${mode === "index" ? "indeksu" : "ceny"} od ${formatWhen(scales.t0)} do ${formatWhen(scales.t1)}. Strzałki w lewo i w prawo przechodzą między notowaniami.`
					: "Wykres"
			}
			onKeyDown={onKeyDown}
			onFocus={() => setActive((current) => current ?? mainPoints.length - 1)}
			onBlur={() => setActive(null)}
			className="relative w-full rounded-sm select-none"
			style={{ height }}
		>
			<svg width={width} height={height} aria-hidden className="block overflow-visible">
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
				{scales.xTicks.ticks.map((tick, i) => {
					const label = scales.xLabels[i]!
					return (
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
								{label.main}
							</text>
							{label.sub ? (
								<text
									x={scales.x(tick)}
									y={MARGIN.top + plotH + 31}
									textAnchor="middle"
									className="num fill-[var(--muted)] text-[10px]"
								>
									{label.sub}
								</text>
							) : null}
						</g>
					)
				})}
				{[...series].reverse().map((s) => (
					<g key={s.id}>
						{splitAtGaps(s.points, gaps.line).map((run) =>
							run.length === 1 ? (
								<circle key={run[0]!.t} cx={scales.x(run[0]!.t)} cy={scales.y(run[0]!.v)} r={2.5} fill={s.color} />
							) : (
								<path
									key={run[0]!.t}
									d={path(run)}
									fill="none"
									stroke={s.color}
									strokeWidth={s === main ? 2 : 1.5}
									strokeLinejoin="round"
									strokeLinecap="round"
								/>
							),
						)}
					</g>
				))}
				{hovered ? (
					<g pointerEvents="none">
						<line
							x1={crosshairX}
							x2={crosshairX}
							y1={MARGIN.top}
							y2={MARGIN.top + plotH}
							stroke="var(--muted)"
							strokeDasharray="2 3"
							shapeRendering="crispEdges"
						/>
						{rows.map(({ series: s, point }) =>
							point ? (
								<circle
									key={s.id}
									cx={scales.x(point.t)}
									cy={scales.y(point.v)}
									r={4}
									fill={s.color}
									stroke="var(--bg)"
									strokeWidth={2}
								/>
							) : null,
						)}
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
					onPointerLeave={(event) => {
						if (event.pointerType === "mouse") setActive(null)
					}}
				/>
			</svg>
			<div aria-live="polite" className="sr-only">
				{hovered
					? `${formatWhen(hovered.t)}: ${rows
							.map(
								({ series: s, point, ownDate }) =>
									`${s.name} ${point ? `${valueText(point, mode, unit)}${ownDate ? ` z ${ownDate}` : ""}` : "brak notowania"}`,
							)
							.join(", ")}`
					: ""}
			</div>
			{hovered ? (
				<div
					ref={tooltip}
					aria-hidden
					className="bg-bg pointer-events-none absolute top-1 z-10 max-w-[min(20rem,100%)] min-w-44 rounded-md border px-2.5 py-1.5 text-xs shadow-[0_6px_16px_-6px_oklch(0_0_0/0.3)]"
					style={{ left: tooltipLeft }}
				>
					<div className="num text-muted mb-1">{formatWhen(hovered.t)}</div>
					{rows.map(({ series: s, point, ownDate }) => (
						<div key={s.id} className="flex items-center gap-2 py-px">
							<span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
							<span className="max-w-36 min-w-0 flex-1 truncate sm:max-w-48">{s.name}</span>
							{point ? (
								<span className="num shrink-0 text-right">
									<span className="font-medium">{valueText(point, mode, unit)}</span>
									{ownDate ? <span className="text-muted block text-[10px] leading-tight">z {ownDate}</span> : null}
								</span>
							) : (
								<span className="text-muted shrink-0">brak notowania</span>
							)}
						</div>
					))}
				</div>
			) : null}
		</div>
	)
}

const valueText = (point: Point, mode: "price" | "index", unit: string) =>
	mode === "index" ? formatPercent(point.v - 100) : `${formatPrice(point.v)} ${unit}`
