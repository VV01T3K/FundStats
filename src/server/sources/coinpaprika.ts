import * as Effect from "effect/Effect"
import { HttpClientRequest } from "effect/http"
import * as Schema from "effect/Schema"

import { metrics } from "#/shared/metrics.ts"
import { SOURCES } from "#/shared/sources.ts"

import { defineSource, fetchJson } from "./Source.ts"

const info = SOURCES.coinpaprika

const TOP = 100

const Change = Schema.optional(Schema.NullOr(Schema.Number))

export const CoinPaprikaTicker = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	symbol: Schema.String,
	rank: Schema.Number,
	last_updated: Schema.optional(Schema.NullOr(Schema.String)),
	quotes: Schema.Struct({
		PLN: Schema.Struct({
			price: Schema.NullOr(Schema.Number),
			market_cap: Schema.optional(Schema.NullOr(Schema.Number)),
			percent_change_1h: Change,
			percent_change_24h: Change,
			percent_change_7d: Change,
		}),
	}),
})
type CoinPaprikaTicker = typeof CoinPaprikaTicker.Type

export const CoinPaprikaPayload = Schema.Array(CoinPaprikaTicker)

const inTop = (ticker: { readonly rank: number }) => ticker.rank > 0 && ticker.rank <= TOP

/**
 * Drops tickers ranked below the top 100 before the response is stored or
 * decoded. Entries without a numeric rank are kept (at most 2×TOP), so a
 * changed upstream shape still leaves a payload to inspect.
 */
const trimTickers = (raw: unknown): unknown =>
	Array.isArray(raw)
		? raw
				.filter((ticker: unknown) => {
					const rank = (ticker as { rank?: unknown } | null)?.rank
					return typeof rank !== "number" || inTop({ rank })
				})
				.slice(0, TOP * 2)
		: raw

export const coinpaprika = defineSource<ReadonlyArray<CoinPaprikaTicker>>({
	info,
	defaultInterval: "30 minutes",
	// Keyless public API. It returns ~2000 coins ordered by rank; only the top
	// 100 are kept, also in the stored raw payload.
	fetch: fetchJson(
		info.id,
		HttpClientRequest.get("https://api.coinpaprika.com/v1/tickers").pipe(
			HttpClientRequest.setUrlParams({ quotes: "PLN" }),
			HttpClientRequest.acceptJson,
		),
	).pipe(Effect.map(trimTickers)),
	payload: CoinPaprikaPayload,
	// The free tier's 30d and 1y changes have been placeholders (one value for
	// every coin), so only 1h, 24h and 7d are stored.
	normalize: (tickers: ReadonlyArray<CoinPaprikaTicker>) =>
		tickers.filter(inTop).map((ticker) => ({
			externalId: ticker.id,
			name: ticker.name,
			symbol: ticker.symbol,
			category: null,
			currency: info.currency,
			metadata: { marketCap: ticker.quotes.PLN.market_cap ?? null },
			asOf: null,
			value: ticker.quotes.PLN.price,
			metrics: metrics({
				rank: ticker.rank,
				change_1h: ticker.quotes.PLN.percent_change_1h,
				change_24h: ticker.quotes.PLN.percent_change_24h,
				change_7d: ticker.quotes.PLN.percent_change_7d,
			}),
		})),
})
