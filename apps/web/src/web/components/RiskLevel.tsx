import { cn } from "#/lib/utils"

/** A fund's place on mBank's scale: one bar per level the data has, filled up to the fund's level. */
export function RiskMeter({
	level,
	max,
	className,
}: {
	readonly level: number
	readonly max: number
	readonly className?: string
}) {
	return (
		<svg
			viewBox={`0 0 ${max * 4 - 1} 10`}
			width={max * 4 - 1}
			height={10}
			aria-hidden
			className={cn("inline-block shrink-0", className)}
		>
			{Array.from({ length: max }, (_, i) => (
				<rect
					key={i}
					x={i * 4}
					y={10 - (4 + (6 * i) / Math.max(1, max - 1))}
					width={3}
					height={4 + (6 * i) / Math.max(1, max - 1)}
					rx={0.75}
					fill="currentColor"
					opacity={i < level ? 0.9 : 0.22}
				/>
			))}
		</svg>
	)
}
