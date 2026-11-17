import { metrics } from "@fundstats/shared/metrics"
import { SOURCES } from "@fundstats/shared/sources"
import * as Effect from "effect/Effect"
import { HttpClientRequest } from "effect/http"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

import { CollectorConfig } from "../config.ts"
import { defineSource, fetchJson } from "./Source.ts"

const info = SOURCES.coingecko

const Change = Schema.optional(Schema.NullOr(Schema.Number))

const CoinGeckoCoin = Schema.Struct({
	id: Schema.String,
	symbol: Schema.String,
	name: Schema.String,
	image: Schema.optional(Schema.NullOr(Schema.String)),
	current_price: Schema.NullOr(Schema.Number),
	market_cap: Schema.optional(Schema.NullOr(Schema.Number)),
	market_cap_rank: Schema.NullOr(Schema.Number),
	last_updated: Schema.optional(Schema.NullOr(Schema.String)),
	price_change_percentage_24h_in_currency: Change,
	price_change_percentage_7d_in_currency: Change,
	price_change_percentage_30d_in_currency: Change,
	price_change_percentage_200d_in_currency: Change,
	price_change_percentage_1y_in_currency: Change,
})

export const CoinGeckoPayload = Schema.Array(CoinGeckoCoin)

export const coingecko = defineSource({
	info,
	fetch: Effect.gen(function* () {
		const config = yield* CollectorConfig
		// Keyless public API; an optional demo key raises the rate limit.
		const request = HttpClientRequest.get("https://api.coingecko.com/api/v3/coins/markets").pipe(
			HttpClientRequest.setUrlParams({
				vs_currency: "pln",
				order: "market_cap_desc",
				per_page: "100",
				page: "1",
				price_change_percentage: "1y,200d,30d,7d,24h",
			}),
			HttpClientRequest.acceptJson,
			(req) =>
				Option.match(config.coingeckoApiKey, {
					onNone: () => req,
					onSome: (key) => HttpClientRequest.setHeader(req, "x-cg-demo-api-key", Redacted.value(key)),
				}),
		)
		return yield* fetchJson(info.id, request)
	}),
	payload: CoinGeckoPayload,
	normalize: (coins) =>
		coins.map((coin) => ({
			externalId: coin.id,
			name: coin.name,
			symbol: coin.symbol.toUpperCase(),
			category: null,
			currency: info.currency,
			metadata: { image: coin.image ?? null, marketCap: coin.market_cap ?? null },
			asOf: null,
			value: coin.current_price,
			metrics: metrics({
				rank: coin.market_cap_rank,
				change_24h: coin.price_change_percentage_24h_in_currency,
				change_7d: coin.price_change_percentage_7d_in_currency,
				change_30d: coin.price_change_percentage_30d_in_currency,
				change_200d: coin.price_change_percentage_200d_in_currency,
				change_1y: coin.price_change_percentage_1y_in_currency,
			}),
		})),
})
