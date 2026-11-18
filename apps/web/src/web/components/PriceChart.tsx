import type { InstrumentKind } from "@fundstats/shared/sources"
import * as DateTime from "effect/DateTime"
import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
	epochToIso,
	formatCaptured,
	formatCapturedDate,
	formatDate,
	formatEpochDay,
	formatFixed,
	formatPrice,
	formatStamp,
} from "../format.ts"
import { GAPS, nearestWithin, niceTicks, type Point, splitAtGaps, timeTicks, type TimeUnit } from "../history.ts"

const MARGIN = { top: 12, right: 72, bottom: 40, left: 2 }

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
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
						? monthFormat.format(t).toUpperCase()
						: isoDay(t).slice(0, 4)
		const changed = i === 0 || context(t) !== context(ticks[i - 1]!)
		return { main, sub: unit !== "year" && changed ? context(t) : null }
	})
}

/**
 * The price line of one instrument over the selected window. Hand-drawn SVG: hairline grid, labels on
 * the right, a crosshair that follows the pointer or the arrow keys and stops only at real quotes.
 */
export function PriceChart({
	points,
	currency,
	kind,
	height = 320,
}: {
	/** Oldest first, already cut to the window. */
	readonly points: ReadonlyArray<Point>
	readonly currency: string
	/** Funds are placed by valuation date, live quotes by capture time. */
	readonly kind: InstrumentKind
	readonly height?: number
}) {
	const wrapper = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(880)
	// The selected time, not an index: after a refresh the same moment is found in the new points.
	const [selected, setSelected] = useState<number | null>(null)
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

	const plotW = width - MARGIN.left - MARGIN.right
	const plotH = height - MARGIN.top - MARGIN.bottom
	const t0 = points[0]?.t ?? 0
	const t1 = points.at(-1)?.t ?? 0
	const up = (points.at(-1)?.v ?? 0) >= (points[0]?.v ?? 0)
	const color = up ? "var(--up)" : "var(--down)"

	const scales = useMemo(() => {
		const values = points.map((p) => p.v)
		const v0 = Math.min(...values)
		const v1 = Math.max(...values)
		const pad = (v1 - v0) * 0.06 || Math.abs(v0) * 0.01 || 1
		const lo = v0 - pad
		const hi = v1 + pad
		const y = niceTicks(lo, hi, plotH < 220 ? 4 : 5)
		const span = t1 - t0 || 1
		const xTicks = timeTicks(t0, t1, Math.max(2, Math.floor(plotW / 96)))
		return {
			span,
			x: (t: number) => MARGIN.left + ((t - t0) / span) * plotW,
			y: (v: number) => MARGIN.top + (1 - (v - lo) / (hi - lo || 1)) * plotH,
			yTicks: y.ticks.filter((tick) => tick >= lo && tick <= hi),
			yStep: y.step,
			xTicks,
			xLabels: tickLabels(xTicks.ticks, xTicks.unit),
		}
	}, [points, t0, t1, plotW, plotH])

	const tickDecimals = scales.yStep >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(scales.yStep)))
	const formatWhen = (t: number) => (kind === "fund" ? formatEpochDay(t) : formatStamp(epochToIso(t)))
	const formatShort = (t: number) => (kind === "fund" ? formatEpochDay(t) : formatCaptured(epochToIso(t)))

	const at = selected === null ? undefined : nearestWithin(points, selected, gaps.hover)

	const onPointer = (event: PointerEvent<SVGRectElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
		setSelected(t0 + ratio * scales.span)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const last = points.length - 1
		const current = at === undefined ? last : points.indexOf(at)
		const moves: Record<string, number> = {
			ArrowLeft: current - 1,
			ArrowRight: current + 1,
			PageUp: current - 10,
			PageDown: current + 10,
			Home: 0,
			End: last,
		}
		if (event.key === "Escape") return setSelected(null)
		const next = moves[event.key]
		if (next === undefined) return
		event.preventDefault()
		setSelected(points[Math.max(0, Math.min(last, next))]?.t ?? null)
	}

	const path = (run: ReadonlyArray<Point>) =>
		run.map((p, i) => `${i === 0 ? "M" : "L"}${scales.x(p.t).toFixed(1)},${scales.y(p.v).toFixed(1)}`).join("")

	const crosshairX = selected === null ? 0 : scales.x(at?.t ?? selected)
	const tooltipWidth = 196
	const tooltipLeft = Math.max(
		0,
		Math.min(
			width - tooltipWidth,
			crosshairX + 12 + tooltipWidth <= width ? crosshairX + 12 : crosshairX - 12 - tooltipWidth,
		),
	)

	return (
		<div
			ref={wrapper}
			tabIndex={0}
			role="group"
			aria-roledescription="chart"
			aria-label={`Price in ${currency} from ${formatWhen(t0)} to ${formatWhen(t1)}. Left and right arrow keys move between quotes.`}
			onKeyDown={onKeyDown}
			onFocus={() => setSelected((current) => current ?? t1)}
			onBlur={() => setSelected(null)}
			className="relative w-full select-none"
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
							stroke="var(--rule)"
							shapeRendering="crispEdges"
						/>
						<text x={MARGIN.left + plotW + 10} y={scales.y(tick)} dy="0.32em" className="fill-dim text-[10px]">
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
							<text x={scales.x(tick)} y={MARGIN.top + plotH + 17} textAnchor="middle" className="fill-dim text-[10px]">
								{label.main}
							</text>
							{label.sub ? (
								<text
									x={scales.x(tick)}
									y={MARGIN.top + plotH + 31}
									textAnchor="middle"
									className="fill-dim text-[10px]"
								>
									{label.sub}
								</text>
							) : null}
						</g>
					)
				})}
				{splitAtGaps(points, gaps.line).map((run) =>
					run.length === 1 ? (
						<circle key={run[0]!.t} cx={scales.x(run[0]!.t)} cy={scales.y(run[0]!.v)} r={2} fill={color} />
					) : (
						<path key={run[0]!.t} d={path(run)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
					),
				)}
				{selected !== null ? (
					<g pointerEvents="none">
						<line
							x1={crosshairX}
							x2={crosshairX}
							y1={MARGIN.top}
							y2={MARGIN.top + plotH}
							stroke="var(--dim)"
							strokeDasharray="2 3"
							shapeRendering="crispEdges"
						/>
						{at ? (
							<circle cx={scales.x(at.t)} cy={scales.y(at.v)} r={3.5} fill={color} stroke="var(--bg)" strokeWidth={2} />
						) : null}
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
						if (event.pointerType === "mouse") setSelected(null)
					}}
				/>
			</svg>
			<div aria-live="polite" className="sr-only">
				{selected === null ? "" : at ? `${formatWhen(at.t)}: ${formatPrice(at.v)} ${currency}` : "No quote here"}
			</div>
			{selected !== null ? (
				<div
					aria-hidden
					className="border-rule-strong bg-panel pointer-events-none absolute top-1 z-10 border px-2.5 py-1.5 text-[11px] shadow-[0_8px_24px_rgb(0_0_0/0.5)]"
					style={{ left: tooltipLeft, width: tooltipWidth }}
				>
					{at ? (
						<>
							<div className="text-dim">{formatShort(at.t)}</div>
							<div className="text-ink mt-0.5 font-semibold">
								{formatPrice(at.v)} <span className="text-dim font-normal">{currency}</span>
							</div>
						</>
					) : (
						<div className="text-dim">No quote here</div>
					)}
				</div>
			) : null}
		</div>
	)
}
