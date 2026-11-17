import * as Effect from "effect/Effect"
import { HttpClientRequest } from "effect/http"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

import { metrics } from "#/shared/metrics.ts"
import { SOURCES } from "#/shared/sources.ts"

import { AppConfig } from "../config.ts"
import { defineSource, fetchJson, type NormalizedRow } from "./Source.ts"

const info = SOURCES.coinmarketcap

const TOP = 100

const Change = Schema.optional(Schema.NullOr(Schema.Number))

/** Official API: https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest */
export const CmcProListings = Schema.Struct({
	status: Schema.Struct({ timestamp: Schema.String }),
	data: Schema.Array(
		Schema.Struct({
			id: Schema.Number,
			name: Schema.String,
			symbol: Schema.String,
			slug: Schema.optional(Schema.String),
			cmc_rank: Schema.NullOr(Schema.Number),
			quote: Schema.Struct({
				USD: Schema.Struct({
					price: Schema.NullOr(Schema.Number),
					market_cap: Schema.optional(Schema.NullOr(Schema.Number)),
					percent_change_1h: Change,
					percent_change_24h: Change,
					percent_change_7d: Change,
					percent_change_30d: Change,
					percent_change_60d: Change,
					percent_change_90d: Change,
				}),
			}),
		}),
	),
})

/** Unofficial endpoint used by coinmarketcap.com itself; no key needed. */
export const CmcWebListing = Schema.Struct({
	status: Schema.Struct({ timestamp: Schema.String }),
	data: Schema.Struct({
		cryptoCurrencyList: Schema.Array(
			Schema.Struct({
				id: Schema.Number,
				name: Schema.String,
				symbol: Schema.String,
				slug: Schema.optional(Schema.String),
				// Sponsored index products are listed without a rank.
				cmcRank: Schema.optional(Schema.NullOr(Schema.Number)),
				quotes: Schema.Array(
					Schema.Struct({
						name: Schema.String,
						price: Schema.optional(Schema.NullOr(Schema.Number)),
						marketCap: Schema.optional(Schema.NullOr(Schema.Number)),
						percentChange1h: Change,
						percentChange24h: Change,
						percentChange7d: Change,
						percentChange30d: Change,
						percentChange60d: Change,
						percentChange90d: Change,
					}),
				),
			}),
		),
	}),
})

/** What the collector stores: the response body tagged with the endpoint it came from. */
export const CmcPayload = Schema.Union([
	Schema.Struct({ api: Schema.Literal("pro"), body: CmcProListings }),
	Schema.Struct({ api: Schema.Literal("web"), body: CmcWebListing }),
])
export type CmcPayload = typeof CmcPayload.Type

const ranked = (rank: number | null | undefined): rank is number => typeof rank === "number" && rank > 0 && rank <= TOP

export const normalizeCmc = (payload: CmcPayload): ReadonlyArray<NormalizedRow> => {
	if (payload.api === "pro") {
		return payload.body.data.flatMap((coin) => {
			if (!ranked(coin.cmc_rank)) return []
			const usd = coin.quote.USD
			return [
				{
					externalId: String(coin.id),
					name: coin.name,
					symbol: coin.symbol,
					category: null,
					currency: info.currency,
					metadata: { slug: coin.slug ?? null, marketCap: usd.market_cap ?? null, api: "pro" },
					asOf: null,
					value: usd.price,
					metrics: metrics({
						rank: coin.cmc_rank,
						change_1h: usd.percent_change_1h,
						change_24h: usd.percent_change_24h,
						change_7d: usd.percent_change_7d,
						change_30d: usd.percent_change_30d,
						change_60d: usd.percent_change_60d,
						change_90d: usd.percent_change_90d,
					}),
				},
			]
		})
	}
	return payload.body.data.cryptoCurrencyList.flatMap((coin) => {
		const usd = coin.quotes.find((quote) => quote.name === "USD")
		if (!ranked(coin.cmcRank) || usd === undefined) return []
		return [
			{
				externalId: String(coin.id),
				name: coin.name,
				symbol: coin.symbol,
				category: null,
				currency: info.currency,
				metadata: { slug: coin.slug ?? null, marketCap: usd.marketCap ?? null, api: "web" },
				asOf: null,
				value: usd.price ?? null,
				metrics: metrics({
					rank: coin.cmcRank,
					change_1h: usd.percentChange1h,
					change_24h: usd.percentChange24h,
					change_7d: usd.percentChange7d,
					change_30d: usd.percentChange30d,
					change_60d: usd.percentChange60d,
					change_90d: usd.percentChange90d,
				}),
			},
		]
	})
}

export const coinmarketcap = defineSource<CmcPayload>({
	info,
	defaultInterval: "30 minutes",
	fetch: Effect.gen(function* () {
		const config = yield* AppConfig
		if (Option.isSome(config.cmcApiKey)) {
			const body = yield* fetchJson(
				info.id,
				HttpClientRequest.get("https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest").pipe(
					HttpClientRequest.setUrlParams({ start: "1", limit: String(TOP), convert: "USD" }),
					HttpClientRequest.acceptJson,
					HttpClientRequest.setHeader("X-CMC_PRO_API_KEY", Redacted.value(config.cmcApiKey.value)),
				),
			)
			return { api: "pro", body }
		}
		// Fallback without a key. It asks for one extra row because sponsored
		// index products without a rank take a slot.
		const body = yield* fetchJson(
			info.id,
			HttpClientRequest.get("https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing").pipe(
				HttpClientRequest.setUrlParams({
					start: "1",
					limit: String(TOP + 5),
					sortBy: "rank",
					sortType: "desc",
					convert: "USD",
					cryptoType: "all",
					tagType: "all",
					audited: "false",
				}),
				HttpClientRequest.setHeaders({
					accept: "application/json, text/plain, */*",
					referer: "https://coinmarketcap.com/",
				}),
			),
		)
		return { api: "web", body }
	}),
	payload: CmcPayload,
	normalize: normalizeCmc,
})
