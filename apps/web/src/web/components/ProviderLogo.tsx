import type { SourceId } from "@fundstats/shared/sources"

import { cn } from "#/lib/utils"

/**
 * A data provider's own logo (public/providers). Decorative: the provider's name is always written
 * next to it. CoinMarketCap uses its white mark, the one it publishes for dark backgrounds.
 */
export function ProviderLogo({
	source,
	size = 14,
	className,
}: {
	readonly source: SourceId
	readonly size?: number
	readonly className?: string
}) {
	return (
		<img
			src={`/providers/${source}.svg`}
			alt=""
			width={size}
			height={size}
			draggable={false}
			className={cn("shrink-0 object-contain", className)}
		/>
	)
}
