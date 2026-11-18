import { useHotkey } from "@tanstack/react-hotkeys"
import { Search, X } from "lucide-react"
import { useRef, useState } from "react"

import { cn } from "#/lib/utils"

import { MAX_QUERY } from "../search.ts"

/**
 * The search box. It keeps what the visitor types (spaces included) as a draft and reports only the
 * trimmed text, which goes to the URL; a URL change from elsewhere (back, a link) replaces the draft.
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
	useHotkey(
		"Escape",
		() => {
			setDraft("")
			onQuery("")
		},
		{ target: input, enabled: draft.length > 0, meta: { name: "Clear search" } },
	)
	if (seen !== query) {
		setSeen(query)
		if (draft.trim() !== query) setDraft(query)
	}

	return (
		<div className={cn("relative", className)}>
			<Search aria-hidden className="text-dim pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
			<input
				type="search"
				data-search
				value={draft}
				maxLength={MAX_QUERY}
				onChange={(event) => {
					const next = event.currentTarget.value
					setDraft(next)
					onQuery(next.trim())
				}}
				ref={input}
				placeholder="Search coins, funds or tickers — e.g. BTC, ETH, Schroder"
				aria-label="Search coins, funds or tickers"
				autoComplete="off"
				spellCheck={false}
				className="border-rule-strong bg-bg text-ink placeholder:text-dim focus:border-warm h-8 w-full appearance-none border pr-9 pl-9 text-[12px] outline-none [&::-webkit-search-cancel-button]:hidden"
			/>
			{draft.length > 0 ? (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => {
						setDraft("")
						onQuery("")
					}}
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
