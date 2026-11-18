/** A sparkline's path through `values`, scaled to fill `width` × `height` inside `pad`. */
const sparkPath = (values: ReadonlyArray<number>, width: number, height: number, pad = 1) => {
	const min = Math.min(...values)
	const range = Math.max(...values) - min || 1
	const dx = (width - pad * 2) / (values.length - 1)
	return values
		.map(
			(v, i) =>
				`${i === 0 ? "M" : "L"}${(pad + i * dx).toFixed(2)} ${(pad + (1 - (v - min) / range) * (height - pad * 2)).toFixed(2)}`,
		)
		.join(" ")
}

/**
 * The last recorded values, green when the last is at or above the first, red below. Fewer than two
 * values draw a dim baseline, so a new instrument's cell says "not enough history" rather than "flat".
 */
export function Sparkline({
	values,
	width = 90,
	height = 18,
	className,
}: {
	readonly values: ReadonlyArray<number> | undefined
	readonly width?: number
	readonly height?: number
	/** CSS may resize it; the line stays 1px (non-scaling stroke). */
	readonly className?: string
}) {
	if (!values || values.length < 2) {
		return (
			<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden className={className}>
				<line
					x1={0}
					x2={width}
					y1={height / 2}
					y2={height / 2}
					stroke="var(--rule-strong)"
					strokeDasharray="2 3"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
		)
	}
	const up = values.at(-1)! >= values[0]!
	return (
		<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden className={className}>
			<path
				d={sparkPath(values, width, height)}
				fill="none"
				stroke={up ? "var(--up)" : "var(--down)"}
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	)
}
