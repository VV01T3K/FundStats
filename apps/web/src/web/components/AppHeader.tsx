import type { SourceStatus } from "@fundstats/shared/api"

import { cn } from "#/lib/utils"

import { formatStamp } from "../format.ts"
import { collectedAt, sourceState, stateDetail, stateLabel } from "../freshness.ts"
import { usePrefs } from "../PrefsContext.tsx"
import { SearchField } from "./SearchField.tsx"
import { SoonBadge, soonLabel, Tip } from "./Tip.tsx"
import { Wordmark } from "./Wordmark.tsx"

const STATE_TEXT = { live: "text-up", cached: "text-warm", stale: "text-down", empty: "text-dim" } as const
const STATE_BG = { live: "bg-up", cached: "bg-warm", stale: "bg-down", empty: "bg-dim" } as const

/** Menu · wordmark · search · freshness of the open source · account. */
export function AppHeader({
	status,
	query,
	onQuery,
	onMenu,
	menuExpanded,
}: {
	readonly status: SourceStatus
	readonly query: string
	readonly onQuery: (query: string) => void
	readonly onMenu: () => void
	readonly menuExpanded: boolean
}) {
	const { prefs } = usePrefs()
	return (
		<header className="border-rule bg-panel text-dim flex shrink-0 items-center gap-3.5 border-b px-4 py-2.5 pt-[max(10px,env(safe-area-inset-top))] text-[11px] lg:px-[18px]">
			<button
				type="button"
				onClick={onMenu}
				aria-label="Menu"
				aria-expanded={menuExpanded}
				className="border-rule-strong text-warm hover:border-warm grid h-6 w-7.5 shrink-0 place-items-center border max-lg:size-11 max-lg:border-0"
			>
				<span aria-hidden className="flex flex-col gap-[3px]">
					<span className="block h-[1.5px] w-3 bg-current" />
					<span className="block h-[1.5px] w-3 bg-current" />
					<span className="block h-[1.5px] w-3 bg-current" />
				</span>
			</button>
			<Wordmark size={20} />
			<SearchField query={query} onQuery={onQuery} className="ml-3 hidden max-w-[460px] flex-1 lg:block" />
			<div className="flex-1" />
			<FreshnessStamp status={status} />
			<div aria-hidden className="bg-rule-strong hidden h-[18px] w-px lg:block" />
			{prefs.showSoon ? (
				<Tip label={soonLabel("Accounts and sign-in")}>
					<button
						type="button"
						aria-disabled="true"
						className="border-rule-strong text-ink-dim hidden h-6 cursor-not-allowed items-center gap-2 border px-3 text-[11px] font-bold tracking-[0.1em] lg:inline-flex"
					>
						SIGN IN
						<SoonBadge />
					</button>
				</Tip>
			) : null}
		</header>
	)
}

function FreshnessStamp({ status }: { readonly status: SourceStatus }) {
	// The header says whether the open table is current; the tab's badge says how it is collected.
	const state = sourceState(status) === "cached" ? "live" : sourceState(status)
	const at = collectedAt(status)
	return (
		<Tip label={stateDetail(status)}>
			<span tabIndex={0} className={cn("inline-flex items-center gap-1.5 outline-offset-4", STATE_TEXT[state])}>
				<span
					aria-hidden
					className={cn("size-1.5", STATE_BG[state], state !== "stale" && state !== "empty" && "live-pulse")}
				/>
				<span className="font-semibold">{state === "live" ? "LIVE" : stateLabel(status)}</span>
				{at ? <span className="text-dim ml-1 hidden sm:inline">{formatStamp(at)}</span> : null}
			</span>
		</Tip>
	)
}
