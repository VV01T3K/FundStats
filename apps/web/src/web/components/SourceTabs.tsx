import type { SourceStatus } from "@fundstats/shared/api"
import { KIND_SEGMENT, SOURCE_IDS, SOURCES, type SourceId } from "@fundstats/shared/sources"
import { Link } from "@tanstack/react-router"

import { cn } from "#/lib/utils"

import { sourceState, stateDetail, stateLabel } from "../freshness.ts"
import { getTable } from "../tables.ts"
import { Tip } from "./Tip.tsx"

const BADGE = { live: "text-up", cached: "text-warm", stale: "text-down", empty: "text-dim" } as const

/** The primary control: one tab per source, above the table. */
export function SourceTabs({
	source,
	statuses,
}: {
	readonly source: SourceId
	readonly statuses: ReadonlyArray<SourceStatus>
}) {
	return (
		<nav aria-label="Data sources" className="border-rule-strong bg-bg shrink-0 border-b">
			<ul className="flex items-stretch max-lg:hidden">
				{SOURCE_IDS.map((id, i) => {
					const active = id === source
					const config = getTable(id)
					return (
						<li key={id} className={cn("min-w-0 flex-1", i > 0 && "border-l border-rule")}>
							<Link
								to="/$kind/$source"
								params={{ kind: KIND_SEGMENT[SOURCES[id].kind], source: id }}
								aria-current={active ? "page" : undefined}
								viewTransition
								className={cn(
									"block h-full border-b-[3px] px-[22px] pt-3.5 pb-[11px] transition-colors duration-120",
									active ? "border-warm bg-panel" : "border-transparent hover:bg-panel/60",
								)}
							>
								<span className="flex min-w-0 items-center gap-2.5">
									<span aria-hidden className={cn("size-2 shrink-0", active ? "bg-warm" : "bg-rule")} />
									<span
										className={cn(
											"truncate text-[13px] tracking-[0.04em]",
											active ? "font-bold text-ink" : "font-medium text-ink-dim",
										)}
									>
										{config.title}
									</span>
									{active ? <StateBadge status={statuses.find((s) => s.id === id)} /> : null}
								</span>
								<span className="text-dim mt-1 block truncate text-[11px]">{config.tagline}</span>
							</Link>
						</li>
					)
				})}
			</ul>
			<ul className="flex [scrollbar-width:none] overflow-x-auto overscroll-x-contain px-2 py-1.5 lg:hidden">
				{SOURCE_IDS.map((id) => {
					const active = id === source
					return (
						<li key={id} className="shrink-0">
							<Link
								to="/$kind/$source"
								params={{ kind: KIND_SEGMENT[SOURCES[id].kind], source: id }}
								aria-current={active ? "page" : undefined}
								viewTransition
								className={cn(
									"flex h-11 items-center gap-2 px-3 text-[11px] tracking-[0.06em] uppercase",
									active ? "bg-panel font-bold text-warm" : "text-dim",
								)}
							>
								<span aria-hidden className={cn("size-1.5 rounded-full", active ? "bg-warm" : "bg-rule-strong")} />
								{id === "mbank" ? "mBank" : SOURCES[id].name}
							</Link>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}

function StateBadge({ status }: { readonly status: SourceStatus | undefined }) {
	if (!status) return null
	const state = sourceState(status)
	return (
		<Tip label={stateDetail(status)}>
			<span
				className={cn(
					"ml-1 inline-flex shrink-0 items-center gap-1 border border-rule-strong bg-bg px-[7px] py-px text-[9px] font-bold tracking-[0.1em]",
					BADGE[state],
				)}
			>
				<span aria-hidden className="size-1 bg-current" />
				{stateLabel(status)}
			</span>
		</Tip>
	)
}
