/**
 * Metadata for every data source, shared by the collector, the API and the web UI. Fetch and normalize
 * logic lives in `apps/collector/src/sources/<id>.ts`; table columns in `apps/web/src/web/tables/index.ts`.
 */
import type * as Duration from "effect/Duration"

export type InstrumentKind = "fund" | "crypto"

export interface SourceInfo {
	readonly id: string
	readonly name: string
	readonly kind: InstrumentKind
	/** Currency the values and changes are quoted in. */
	readonly currency: string
	readonly homepage: string
	readonly description: string
	/** Path of the brand icon under `public/`. */
	readonly icon: string
	/** How often the collector runs it; override with COLLECTOR_INTERVAL_<ID>. */
	readonly defaultInterval: Duration.Input
}

export const SOURCES = {
	mbank: {
		id: "mbank",
		name: "mBank",
		kind: "fund",
		currency: "PLN",
		homepage: "https://www.mbank.pl/serwis-ekonomiczny/notowania-funduszy/",
		description: "Investment funds sold through mBank (SFI), as published by mBank.",
		icon: "/icons/mbank.svg",
		defaultInterval: "6 hours",
	},
	coingecko: {
		id: "coingecko",
		name: "CoinGecko",
		kind: "crypto",
		currency: "PLN",
		homepage: "https://www.coingecko.com/",
		description: "Top 100 coins by market cap from the official CoinGecko public API.",
		icon: "/icons/coingecko.svg",
		defaultInterval: "30 minutes",
	},
	coinpaprika: {
		id: "coinpaprika",
		name: "CoinPaprika",
		kind: "crypto",
		currency: "PLN",
		homepage: "https://coinpaprika.com/",
		description: "Top 100 coins by rank from the official CoinPaprika free API.",
		icon: "/icons/coinpaprika.svg",
		defaultInterval: "30 minutes",
	},
	coinmarketcap: {
		id: "coinmarketcap",
		name: "CoinMarketCap",
		kind: "crypto",
		currency: "USD",
		homepage: "https://coinmarketcap.com/",
		description: "Top 100 coins by CoinMarketCap rank, quoted in USD.",
		icon: "/icons/coinmarketcap.svg",
		defaultInterval: "30 minutes",
	},
} as const satisfies Record<string, SourceInfo>

export type SourceId = keyof typeof SOURCES

export const SOURCE_IDS = Object.keys(SOURCES) as ReadonlyArray<SourceId>

export const isSourceId = (value: string): value is SourceId => Object.hasOwn(SOURCES, value)

/** URL segment for each instrument kind: /funds/mbank, /crypto/coingecko. */
export const KIND_SEGMENT = { fund: "funds", crypto: "crypto" } as const satisfies Record<InstrumentKind, string>
