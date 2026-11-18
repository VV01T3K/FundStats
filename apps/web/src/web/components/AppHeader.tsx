import type { SourceStatus } from "@fundstats/shared/api"
import { SOURCES, type SourceId } from "@fundstats/shared/sources"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { Moon, Sun } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { cn } from "#/lib/utils"

import { sourcesQuery } from "../api.ts"
import { freshness } from "../freshness.ts"
import { IconButton, StatusDot } from "./controls.tsx"

const CRYPTO_SOURCES = ["coingecko", "coinpaprika", "coinmarketcap"] as const satisfies ReadonlyArray<SourceId>

/** Narrow screens fit all three providers in one row with these. */
const SHORT_NAMES = { coingecko: "Gecko", coinpaprika: "Paprika", coinmarketcap: "CMC" } as const

const THEME_KEY = "fundstats-theme"

/** Runs before first paint so a chosen theme never flashes the other one. */
export const themeScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`

const toggleTheme = () => {
	const root = document.documentElement
	const current = root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
	const next = current === "dark" ? "light" : "dark"
	root.dataset.theme = next
	try {
		localStorage.setItem(THEME_KEY, next)
	} catch {
		// Private mode: the choice lasts for this page only.
	}
}

const useStatuses = () => {
	const { data } = useQuery(sourcesQuery())
	return new Map<SourceId, SourceStatus>((data ?? []).map((status) => [status.id, status]))
}

function Dot({ status }: { readonly status: SourceStatus | undefined }) {
	if (!status) return null
	return <StatusDot warn={freshness(status, null).warn} />
}

/**
 * Wordmark, Fundusze | Kryptowaluty, the crypto provider switch and the theme toggle. Below `lg` the
 * switch takes a second row; `--header-h` in styles.css follows it.
 */
export function AppHeader() {
	const params = useParams({ strict: false })
	const statuses = useStatuses()
	const onCrypto = params.kind === "crypto"
	const cryptoWarn = CRYPTO_SOURCES.some((id) => {
		const status = statuses.get(id)
		return status ? freshness(status, null).warn : false
	})

	const navLink = "inline-flex h-12 items-center gap-1.5 border-b-2 px-1 text-[13.5px] transition-colors duration-150"
	return (
		<header className="bg-bg sticky top-0 z-20 border-b" data-providers={onCrypto || undefined}>
			<div className="mx-auto flex h-12 max-w-[1600px] items-center gap-5 px-4">
				<Link to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
					<Mark />
					<span className="max-[379px]:sr-only">FundStats</span>
				</Link>
				<nav aria-label="Tabele" className="flex items-center gap-4">
					<Link
						to="/$kind/$source"
						params={{ kind: "funds", source: "mbank" }}
						className={cn(
							navLink,
							params.kind === "funds" ? "text-fg border-fg font-medium" : "text-muted hover:text-fg border-transparent",
						)}
					>
						Fundusze <span className="text-muted max-sm:hidden">mBank</span>
						<Dot status={statuses.get("mbank")} />
					</Link>
					<Link
						to="/$kind/$source"
						params={{ kind: "crypto", source: onCrypto && params.source ? (params.source as SourceId) : "coingecko" }}
						className={cn(
							navLink,
							onCrypto ? "text-fg border-fg font-medium" : "text-muted hover:text-fg border-transparent",
						)}
					>
						<span className="max-sm:hidden">Kryptowaluty</span>
						<span className="sm:hidden">Krypto</span>
						{statuses.size > 0 ? <StatusDot warn={cryptoWarn} /> : null}
					</Link>
				</nav>
				{onCrypto ? <ProviderSwitch current={params.source as SourceId} className="max-lg:hidden" /> : null}
				<div className="ml-auto flex items-center gap-1">
					<a href="/api/docs" className="text-muted hover:text-fg px-2 text-[13px] max-sm:hidden">
						API
					</a>
					<IconButton onClick={toggleTheme} aria-label="Przełącz jasny / ciemny motyw" title="Motyw">
						<Sun className="size-4 dark:hidden" />
						<Moon className="hidden size-4 dark:block" />
					</IconButton>
				</div>
			</div>
			{onCrypto ? (
				<div className="mx-auto flex h-14 max-w-[1600px] items-center px-4 sm:h-11 lg:hidden">
					<ProviderSwitch current={params.source as SourceId} className="w-full sm:w-auto" />
				</div>
			) : null}
		</header>
	)
}

/** CoinGecko PLN | CoinPaprika PLN | CoinMarketCap USD, each with its freshness dot. */
function ProviderSwitch({ current, className }: { readonly current: SourceId; readonly className?: string }) {
	const statuses = useStatuses()
	return (
		<div className={cn("flex min-w-0 items-center gap-2", className)}>
			<span className="text-muted text-xs max-sm:sr-only">Dostawca</span>
			<div className="bg-panel flex items-center gap-0.5 rounded-md border p-0.5 max-sm:w-full">
				{CRYPTO_SOURCES.map((id) => {
					const status = statuses.get(id)
					const fresh = status ? freshness(status, null) : null
					const active = id === current
					return (
						<Tooltip key={id}>
							<TooltipTrigger asChild>
								<Link
									to="/$kind/$source"
									params={{ kind: "crypto", source: id }}
									aria-current={active ? "page" : undefined}
									aria-label={`${SOURCES[id].name}, ${SOURCES[id].currency}${fresh?.warn ? ", dane nieaktualne" : ""}`}
									className={cn(
										"inline-flex h-11 items-center gap-1.5 rounded-[5px] px-3 text-[13px] whitespace-nowrap transition-colors duration-150 max-sm:flex-1 max-sm:justify-center max-sm:px-1 sm:h-7 sm:px-2.5",
										active
											? "bg-bg text-fg ring-rule font-medium shadow-[0_1px_2px_oklch(0_0_0/0.12)] ring-1"
											: "text-muted hover:text-fg",
									)}
								>
									<span className="max-sm:hidden">{SOURCES[id].name}</span>
									<span className="sm:hidden">{SHORT_NAMES[id]}</span>
									<span className="text-muted text-[11px] font-normal">{SOURCES[id].currency}</span>
									<Dot status={status} />
								</Link>
							</TooltipTrigger>
							{fresh ? <TooltipContent>{fresh.warn ? fresh.detail : fresh.line}</TooltipContent> : null}
						</Tooltip>
					)
				})}
			</div>
		</div>
	)
}

/** Three rising bars of a ranking, drawn to the type's cap height. */
function Mark() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden className="text-accent size-4">
			<rect x="1.5" y="9" width="3" height="5.5" rx="0.75" fill="currentColor" opacity="0.55" />
			<rect x="6.5" y="5.5" width="3" height="9" rx="0.75" fill="currentColor" opacity="0.8" />
			<rect x="11.5" y="1.5" width="3" height="13" rx="0.75" fill="currentColor" />
		</svg>
	)
}
