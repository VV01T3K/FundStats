import { assert, describe, it } from "@effect/vitest"

import { metrics, momentum } from "../src/metrics.ts"

describe("momentum", () => {
	it("weights recent periods more: (4·1m + 3·3m + 2·6m + 1·1y) / 10", () => {
		const m = { change_1m: 10, change_3m: 5, change_6m: -2, change_1y: 20 }
		assert.closeTo(momentum(m) as number, (40 + 15 - 4 + 20) / 10, 1e-9)
	})

	it("is null when a period is missing", () => {
		assert.isNull(momentum({ change_1m: 1, change_3m: 1, change_6m: 1 }))
	})

	it("metrics() drops null, undefined and non-finite values", () => {
		assert.deepStrictEqual(metrics({ change_1m: 1, change_3m: null, change_6m: undefined, change_1y: Number.NaN }), {
			change_1m: 1,
		})
	})
})
