import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
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

export const coinpaprika = defineSource<ReadonlyArray<CoinPaprikaTicker>>({
	info,
	defaultInterval: "30 minutes",
	fetch: Effect.gen(function* () {
		// Keyless public API. It returns ~2000 coins ordered by rank; only the top
		// 100 are kept, also in the stored raw payload.
		const { raw, payload } = yield* fetchJson(
			info.id,
			HttpClientRequest.get("https://api.coinpaprika.com/v1/tickers").pipe(
				HttpClientRequest.setUrlParams({ quotes: "PLN" }),
				HttpClientRequest.acceptJson,
			),
			CoinPaprikaPayload,
		)
		const keep = payload.map(inTop)
		return {
			payload: payload.filter((_, i) => keep[i]),
			raw: Array.isArray(raw) ? raw.filter((_, i) => keep[i]) : raw,
		}
	}),
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
