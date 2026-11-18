import { Search, X } from "lucide-react"
import { useEffect, useState } from "react"

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
				onKeyDown={(event) => {
					if (event.key === "Escape" && draft.length > 0) {
						event.preventDefault()
						setDraft("")
						onQuery("")
					}
				}}
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

/** `/` focuses whichever search box is on screen, unless the visitor is typing somewhere. */
export function useSlashToSearch() {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
			const target = event.target as HTMLElement | null
			if (target?.closest("input, textarea, select, [contenteditable='true']")) return
			const field = [...document.querySelectorAll<HTMLInputElement>("input[data-search]")].find((input) =>
				input.checkVisibility(),
			)
			if (!field) return
			event.preventDefault()
			field.focus()
			field.select()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])
}
