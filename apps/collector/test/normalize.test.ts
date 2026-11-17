import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { CoinGeckoPayload, coingecko } from "#/sources/coingecko.ts"
import { CmcProListings, CmcWebListing, normalizeCmc } from "#/sources/coinmarketcap.ts"
import { CoinPaprikaPayload, coinpaprika } from "#/sources/coinpaprika.ts"
import { MbankPayload, mbank } from "#/sources/mbank.ts"

import { fixture } from "./fixtures.ts"

const decodeMbank = Schema.decodeUnknownEffect(MbankPayload)

/** The element at `index`; fails the test when it is missing. */
const at = <A>(items: ReadonlyArray<A>, index: number): A => {
	const item = items[index]
	assert.isDefined(item)
	return item
}

const decode = <S extends Schema.Top & Schema.Codec<S["Type"], S["Encoded"], never, never>>(
	schema: S,
	name: Parameters<typeof fixture>[0],
) => Schema.decodeUnknownEffect(schema)(fixture(name)) as Effect.Effect<S["Type"], Schema.SchemaError>

describe("mbank normalize", () => {
	it.effect("maps fund yields to fund metrics and keeps the valuation date", () =>
		Effect.gen(function* () {
			const rows = mbank.normalize(yield* decode(MbankPayload, "mbank-funds.json"))
			assert.strictEqual(rows.length, 8)
			const first = at(rows, 0)
			assert.strictEqual(first.category, "akcyjny")
			assert.match(first.asOf ?? "", /^\d{4}-\d{2}-\d{2}$/)
			assert.strictEqual(first.currency, "PLN")
			assert.isNumber(first.value)
			assert.deepStrictEqual(Object.keys(first.metrics).sort(), [
				"change_1d",
				"change_1m",
				"change_1y",
				"change_3m",
				"change_3y",
				"change_5y",
				"change_6m",
				"change_max",
			])
			const raw = fixture("mbank-funds.json") as Array<{ yield12m: number; id: string }>
			assert.strictEqual(first.externalId, at(raw, 0).id)
			assert.strictEqual(first.metrics.change_1y, at(raw, 0).yield12m)
			assert.sameMembers([...new Set(rows.map((r) => r.category))], ["akcyjny", "dłużny", "mieszany", "alternatywny"])
		}),
	)

	it.effect("rejects a payload that is not a list of funds", () =>
		Effect.gen(function* () {
			const result = yield* decodeMbank({ error: "maintenance" }).pipe(Effect.flip)
			assert.strictEqual(result._tag, "SchemaError")
		}),
	)
})

describe("coingecko normalize", () => {
	it.effect("maps PLN changes and leaves out missing periods", () =>
		Effect.gen(function* () {
			const rows = coingecko.normalize(yield* decode(CoinGeckoPayload, "coingecko-markets.json"))
			assert.strictEqual(rows.length, 5)
			assert.strictEqual(at(rows, 0).externalId, "bitcoin")
			assert.strictEqual(at(rows, 0).symbol, "BTC")
			assert.strictEqual(at(rows, 0).metrics.rank, 1)
			assert.isNumber(at(rows, 0).metrics.change_1y)
			assert.isNull(at(rows, 0).asOf)
			// The last fixture coin has no 1y history.
			assert.isUndefined(at(rows, 4).metrics.change_1y)
			assert.isNumber(at(rows, 4).metrics.change_24h)
		}),
	)
})

describe("coinpaprika normalize", () => {
	it.effect("keeps the top 100 and only the real free-tier periods", () =>
		Effect.gen(function* () {
			const payload = yield* decode(CoinPaprikaPayload, "coinpaprika-tickers.json")
			assert.strictEqual(payload.length, 5)
			const rows = coinpaprika.normalize(payload)
			assert.strictEqual(rows.length, 4, "rank 101 is dropped")
			assert.strictEqual(at(rows, 0).externalId, "btc-bitcoin")
			assert.deepStrictEqual(Object.keys(at(rows, 0).metrics).sort(), ["change_1h", "change_24h", "change_7d", "rank"])
		}),
	)
})

describe("coinmarketcap normalize", () => {
	it.effect("web endpoint: skips unranked sponsored rows and reads the USD quote", () =>
		Effect.gen(function* () {
			const body = yield* decode(CmcWebListing, "coinmarketcap-web-listing.json")
			const rows = normalizeCmc({ api: "web", body })
			assert.strictEqual(rows.length, 4)
			assert.strictEqual(at(rows, 0).name, "Bitcoin")
			assert.strictEqual(at(rows, 0).metrics.rank, 1)
			assert.isNumber(at(rows, 0).metrics.change_90d)
			assert.strictEqual(at(rows, 0).currency, "USD")
		}),
	)

	it.effect("official API: same metric names as the web endpoint", () =>
		Effect.gen(function* () {
			const body = yield* decode(CmcProListings, "coinmarketcap-pro-listings.json")
			const rows = normalizeCmc({ api: "pro", body })
			assert.strictEqual(rows.length, 2)
			assert.strictEqual(at(rows, 0).externalId, "1")
			assert.strictEqual(at(rows, 0).metrics.change_30d, -20.5)
			assert.isUndefined(at(rows, 1).metrics.change_30d, "null upstream value is not stored")
			assert.strictEqual(at(rows, 1).metadata.api, "pro")
		}),
	)
})
