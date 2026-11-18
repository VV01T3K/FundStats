import { createChartScene, defineChart, lineY } from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { renderChartSvg } from "@tanstack/charts/svg"
import { useMemo } from "react"

import { formatPercent } from "../format.ts"

/**
 * One row's sparkline: a TanStack Charts scene serialized to static SVG. A live `<Chart>` per row
 * would mount a DOM host, a ResizeObserver and keyboard focus in each of up to 257 rows; a sparkline
 * needs none of that.
 */
const sparklineSvg = (values: ReadonlyArray<number>) => {
	const up = values.at(-1)! >= values[0]!
	const rows = values.map((value, index) => ({ index, value }))
	const scene = createChartScene(
		defineChart({
			marks: [lineY(rows, { x: "index", y: "value", stroke: up ? "var(--up)" : "var(--down)", strokeWidth: 1 })],
			scales: { x: { scale: scaleLinear, axis: false }, y: { scale: scaleLinear, axis: false } },
			margin: 1,
		}),
		{ width: 90, height: 18 },
	)
	return renderChartSvg(scene, {
		ariaLabel: `Last ${values.length} prices: ${formatPercent((values.at(-1)! / values[0]! - 1) * 100)}`,
		className: "spark",
		tabIndex: -1,
	})
}

/**
 * The last recorded values, green when the last is at or above the first, red below. Fewer than two
 * values draw a dashed baseline, so a new instrument's cell says "not enough history" rather than "flat".
 */
export function Sparkline({
	values,
	className,
}: {
	readonly values: ReadonlyArray<number> | undefined
	/** Sets the size; the SVG fills it and its line stays 1px wide. */
	readonly className?: string
}) {
	const markup = useMemo(() => (values && values.length >= 2 ? sparklineSvg(values) : null), [values])
	if (markup === null) {
		return (
			<span role="img" aria-label="Not enough history" className={className}>
				<span aria-hidden className="border-rule-strong block h-1/2 border-b border-dashed" />
			</span>
		)
	}
	// renderChartSvg's own serialization of a scene built from numbers; it escapes all text.
	return <span className={className} dangerouslySetInnerHTML={{ __html: markup }} />
}
