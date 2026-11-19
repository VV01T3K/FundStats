import { Autocomplete } from "@base-ui/react/autocomplete"
import type { SearchResult } from "@fundstats/shared/api"
import { KIND_SEGMENT, SOURCES } from "@fundstats/shared/sources"
import { useHotkey } from "@tanstack/react-hotkeys"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Search, X } from "lucide-react"
import { useRef, useState } from "react"

import { cn } from "#/lib/utils"

import { searchQuery } from "../api.ts"
import { MAX_QUERY } from "../search.ts"

/** The fewest characters that ask the other sources too. */
const SUGGEST_FROM = 2

type Hit = SearchResult["hits"][number]

const keyOf = (hit: Hit) => `${hit.source}:${hit.externalId}`

/**
 * The search box. It filters the open table as you type, and lists matching instruments from every
 * source below it; picking one opens its page. It keeps what the visitor types (spaces included) as a
 * draft and reports only the trimmed text, which goes to the URL; a URL change from elsewhere (back,
 * a link) replaces the draft.
 */
export function SearchField({
	query,
	onQuery,
	className,
}: {
	readonly query: string
	readonly onQuery: (query: string) => void
	readonly className?: string
}) {
	const [draft, setDraft] = useState(query)
	const [seen, setSeen] = useState(query)
	const input = useRef<HTMLInputElement>(null)
	const navigate = useNavigate()
	const term = draft.trim()
	const suggestions = useQuery({
		...searchQuery(term),
		enabled: term.length >= SUGGEST_FROM,
		placeholderData: keepPreviousData,
	})
	if (seen !== query) {
		setSeen(query)
		if (draft.trim() !== query) setDraft(query)
	}

	const hits = term.length >= SUGGEST_FROM ? (suggestions.data?.hits ?? []) : []
	// One group per source, in the order of each source's best hit (the API ranks exact tickers first).
	const groups = [...new Set(hits.map((hit) => hit.source))].map((source) => ({
		value: source,
		items: hits.filter((hit) => hit.source === source),
	}))

	const change = (next: string) => {
		setDraft(next)
		onQuery(next.trim())
	}
	const open = (hit: Hit) => {
		input.current?.blur()
		void navigate({
			to: "/$kind/$source/$externalId",
			params: { kind: KIND_SEGMENT[SOURCES[hit.source].kind], source: hit.source, externalId: hit.externalId },
		})
	}

	return (
		<Autocomplete.Root
			items={groups}
			mode="none"
			value={draft}
			onValueChange={(next, details) => {
				// Picking a suggestion (click or Enter) opens it rather than typing it into the box.
				const picked = details.reason === "item-press" ? hits.find((hit) => keyOf(hit) === next) : undefined
				if (picked) open(picked)
				else change(next)
			}}
			itemToStringValue={keyOf}
		>
			<div className={cn("relative", className)}>
				<Search
					aria-hidden
					className="text-dim pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
				/>
				<Autocomplete.Input
					ref={input}
					type="search"
					data-search
					maxLength={MAX_QUERY}
					placeholder="Search coins, funds or tickers — e.g. BTC, ETH, Schroder"
					aria-label="Search coins, funds or tickers in every source"
					autoComplete="off"
					spellCheck={false}
					className="border-rule-strong bg-bg text-ink placeholder:text-dim focus:border-warm h-8 w-full appearance-none border pr-9 pl-9 text-[12px] outline-none [&::-webkit-search-cancel-button]:hidden"
				/>
				{draft.length > 0 ? (
					<button
						type="button"
						aria-label="Clear search"
						onClick={() => change("")}
						className="text-dim hover:text-ink absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center"
					>
						<X aria-hidden className="size-3.5" />
					</button>
				) : (
					<kbd
						aria-hidden
						className="border-rule text-dim pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 border px-1.5 text-[10px] max-lg:hidden"
					>
						/
					</kbd>
				)}
			</div>
			<Autocomplete.Portal>
				<Autocomplete.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-40">
					<Autocomplete.Popup className="popup border-rule-strong bg-panel text-ink max-h-[min(420px,60dvh)] w-[var(--anchor-width)] min-w-[320px] overflow-auto overscroll-contain border text-[12px] shadow-[0_12px_32px_rgb(0_0_0/0.5)]">
						<Autocomplete.Empty className="text-dim px-3.5 py-3 text-[11px] empty:hidden">
							{term.length >= SUGGEST_FROM && suggestions.isSuccess ? `Nothing in any source matches “${term}”.` : null}
						</Autocomplete.Empty>
						<Autocomplete.List>
							{(group: (typeof groups)[number]) => (
								<Autocomplete.Group
									key={group.value}
									items={group.items}
									className="border-rule border-b last:border-b-0"
								>
									<Autocomplete.GroupLabel className="text-warm px-3.5 pt-2.5 pb-1 text-[10px] tracking-[0.14em] uppercase">
										{SOURCES[group.value].name}
									</Autocomplete.GroupLabel>
									<Autocomplete.Collection>
										{(hit: Hit) => (
											<Autocomplete.Item
												key={keyOf(hit)}
												value={hit}
												className="data-[highlighted]:bg-panel-2 flex min-h-8 cursor-pointer items-center gap-2.5 px-3.5 max-lg:min-h-11"
											>
												<span className="text-ink w-[9ch] shrink-0 truncate font-semibold">{hit.symbol ?? "–"}</span>
												<span className="text-ink-dim min-w-0 flex-1 truncate">{hit.name}</span>
												{hit.category ? (
													<span className="text-dim shrink-0 text-[10px] uppercase">{hit.category}</span>
												) : null}
											</Autocomplete.Item>
										)}
									</Autocomplete.Collection>
								</Autocomplete.Group>
							)}
						</Autocomplete.List>
					</Autocomplete.Popup>
				</Autocomplete.Positioner>
			</Autocomplete.Portal>
		</Autocomplete.Root>
	)
}

/** `/` focuses whichever search box is on screen; typing in a field is left alone. */
export function useSlashToSearch() {
	useHotkey(
		"/",
		() => {
			const field = [...document.querySelectorAll<HTMLInputElement>("input[data-search]")].find((input) =>
				input.checkVisibility(),
			)
			field?.focus()
			field?.select()
		},
		{ meta: { name: "Search" } },
	)
}
