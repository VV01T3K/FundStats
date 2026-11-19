import { useQuery } from "@tanstack/react-query"

import { cn } from "#/lib/utils"

import { healthQuery } from "../api.ts"
import { Tip } from "./Tip.tsx"

/** API status (health and round trip, measured from this browser), collector state, repository and version. */
export function Footer() {
	// Health is the server's, not the data's: checked once a minute while the page is open.
	const health = useQuery({ ...healthQuery(), refetchInterval: 60_000 })
	const ok = health.isSuccess
	return (
		<footer className="border-rule bg-panel text-dim flex shrink-0 items-center gap-[18px] border-t px-4 py-1.5 text-[11px] max-lg:hidden lg:px-[18px]">
			<Tip
				label={
					ok
						? "The API answered its health check."
						: health.isError
							? "The API's health check failed."
							: "Checking the API…"
				}
				side="top"
			>
				<span tabIndex={0} className="inline-flex items-center gap-1.5">
					<span
						aria-hidden
						className={cn("size-1.5 rounded-full", ok ? "bg-up" : health.isError ? "bg-down" : "bg-dim")}
					/>
					API <span className="text-ink">{ok ? `${health.data.ms}ms` : health.isError ? "DOWN" : "…"}</span>
				</span>
			</Tip>
			{ok && !health.data.collectorEnabled ? (
				<Tip label="No collector is scheduled, so the data will not update until it runs again." side="top">
					<span tabIndex={0} className="text-warm">
						Updates paused
					</span>
				</Tip>
			) : null}
			<div className="flex-1" />
			<a href="https://github.com/VV01T3K/FundStats" className="hover:text-ink">
				github.com/VV01T3K/FundStats
			</a>
			<span>v{__APP_VERSION__}</span>
		</footer>
	)
}
