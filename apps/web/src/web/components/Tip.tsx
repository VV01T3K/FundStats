import { Tooltip } from "@base-ui/react/tooltip"
import type { ReactElement, ReactNode } from "react"

import { cn } from "#/lib/utils"

/** A hint on hover and keyboard focus. `children` must be one focusable element. */
export function Tip({
	label,
	children,
	side = "bottom",
}: {
	readonly label: ReactNode
	readonly children: ReactElement
	readonly side?: "top" | "bottom" | "left" | "right"
}) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger delay={300} render={children} />
			<Tooltip.Portal>
				<Tooltip.Positioner side={side} sideOffset={6} collisionPadding={8} className="z-50">
					<Tooltip.Popup className="popup border-rule-strong bg-panel text-ink max-w-72 border px-2.5 py-1.5 text-[11px] leading-snug shadow-[0_8px_24px_rgb(0_0_0/0.5)]">
						{label}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	)
}

export const TipProvider = Tooltip.Provider

/** The `SOON` tag of a feature that has no backend yet. */
export function SoonBadge({ className }: { readonly className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex h-3.5 items-center border border-rule-strong px-1 text-[11px] font-bold tracking-[0.08em] text-dim",
				className,
			)}
		>
			SOON
		</span>
	)
}

/** Says why a stub does nothing. */
export const soonLabel = (feature: string) => `${feature}: coming soon`
