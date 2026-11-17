import * as Effect from "effect/Effect"
import { HttpClientRequest } from "effect/http"
import * as Schema from "effect/Schema"

import { metrics } from "#/shared/metrics.ts"
import { SOURCES } from "#/shared/sources.ts"

import { defineSource, fetchJson } from "./Source.ts"

const info = SOURCES.mbank

/** A missing or null yield means the fund has no data for that period. */
const Yield = Schema.optional(Schema.NullOr(Schema.Number))

const Named = Schema.Struct({ id: Schema.optional(Schema.String), name: Schema.String })

const MbankFund = Schema.Struct({
	id: Schema.Union([Schema.String, Schema.Number]),
	funId: Schema.optional(Schema.NullOr(Schema.String)),
	shortName: Schema.String,
	longName: Schema.optional(Schema.NullOr(Schema.String)),
	currency: Schema.optional(Schema.NullOr(Schema.String)),
	category: Schema.Struct({ key: Schema.optional(Schema.String), value: Schema.String }),
	risk: Schema.optional(
		Schema.NullOr(Schema.Struct({ name: Schema.optional(Schema.String), scale: Schema.optional(Schema.Number) })),
	),
	umbrella: Schema.optional(Schema.NullOr(Named)),
	/** Valuation date, YYYY-MM-DD. */
	date: Schema.String,
	value: Yield,
	yield1d: Yield,
	yield1m: Yield,
	yield3m: Yield,
	yield6m: Yield,
	yield12m: Yield,
	yield3y: Yield,
	yield5y: Yield,
	yieldMax: Yield,
})
type MbankFund = typeof MbankFund.Type

export const MbankPayload = Schema.Array(MbankFund)

export const mbank = defineSource({
	info,
	// The feed changes once per business day.
	defaultInterval: "6 hours",
	fetch: Effect.suspend(() =>
		fetchJson(
			info.id,
			HttpClientRequest.get("https://www.mbank.pl/api/sfi/funds.json").pipe(
				HttpClientRequest.setHeaders({
					accept: "application/json, */*",
					referer: "https://www.mbank.pl/serwis-ekonomiczny/notowania-funduszy/",
				}),
			),
		),
	),
	payload: MbankPayload,
	normalize: (funds) =>
		funds.map((fund) => ({
			externalId: String(fund.id),
			name: fund.shortName.trim(),
			symbol: fund.funId ?? null,
			category: fund.category.value.trim(),
			currency: fund.currency ?? info.currency,
			metadata: {
				longName: fund.longName ?? null,
				categoryKey: fund.category.key ?? null,
				riskScale: fund.risk?.scale ?? null,
				riskName: fund.risk?.name?.trim() ?? null,
				umbrella: fund.umbrella?.name ?? null,
			},
			asOf: fund.date,
			value: fund.value ?? null,
			metrics: metrics({
				change_1d: fund.yield1d,
				change_1m: fund.yield1m,
				change_3m: fund.yield3m,
				change_6m: fund.yield6m,
				change_1y: fund.yield12m,
				change_3y: fund.yield3y,
				change_5y: fund.yield5y,
				change_max: fund.yieldMax,
			}),
		})),
})
