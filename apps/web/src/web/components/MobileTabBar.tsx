import { cn } from "#/lib/utils"

import { soonLabel, Tip } from "./Tip.tsx"

const TABS = [
	{ label: "MKT", name: "Dashboard" },
	{ label: "LIST", name: "Markets" },
	{ label: "WATCH", name: "Watchlist" },
	{ label: "ALERTS", name: "Alerts" },
	{ label: "ME", name: "Account" },
] as const

/** The phone's bottom bar (variants/mobile.jsx). LIST is the tables; the rest have no backend yet. */
export function MobileTabBar() {
	return (
		<nav
			aria-label="Sections"
			className="border-rule bg-bg sticky bottom-0 z-10 flex shrink-0 border-t pb-[max(10px,env(safe-area-inset-bottom))] lg:hidden"
		>
			{TABS.map((tab) =>
				tab.label === "LIST" ? (
					<span
						key={tab.label}
						aria-current="page"
						className="text-warm flex h-11 flex-1 items-center justify-center text-[11px] tracking-[0.06em]"
					>
						{tab.label}
					</span>
				) : (
					<Tip key={tab.label} label={soonLabel(tab.name)} side="top">
						<button
							type="button"
							aria-disabled="true"
							aria-label={`${tab.name} (coming soon)`}
							className={cn("h-11 flex-1 cursor-not-allowed text-[11px] tracking-[0.06em] text-dim")}
						>
							{tab.label}
						</button>
					</Tip>
				),
			)}
		</nav>
	)
}
