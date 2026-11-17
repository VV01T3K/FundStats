import { assert, describe, it } from "@effect/vitest"
import { Duration } from "effect"
import { isStale } from "#/server/api/handlers.ts"
import type { CollectionRun } from "#/shared/api.ts"
import { metrics, momentum } from "#/shared/metrics.ts"
import { resolveView, validateTableSearch } from "#/web/search.ts"
import { TABLES } from "#/web/tables/index.ts"

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

const run = (status: CollectionRun["status"], startedAt: Date): CollectionRun => ({
	id: 1,
	status,
	trigger: "schedule",
	startedAt: startedAt.toISOString(),
	finishedAt: startedAt.toISOString(),
	instrumentCount: 1,
	rowsWritten: 1,
	error: null,
})

describe("staleness", () => {
	const now = Date.parse("2026-11-16T12:00:00Z")
	const interval = Duration.minutes(30)

	it("is fresh shortly after a success", () => {
		const ok = run("success", new Date(now - 20 * 60_000))
		assert.isFalse(isStale({ lastRun: ok, lastSuccess: ok }, interval, now))
	})

	it("is stale after a failed run, even with older data", () => {
		const ok = run("success", new Date(now - 20 * 60_000))
		assert.isTrue(isStale({ lastRun: run("failed", new Date(now)), lastSuccess: ok }, interval, now))
	})

	it("is stale when the last success is more than two intervals old", () => {
		const ok = run("success", new Date(now - 70 * 60_000))
		assert.isTrue(isStale({ lastRun: ok, lastSuccess: ok }, interval, now))
	})
})

describe("table view search params", () => {
	it("falls back to the source defaults for missing or invalid values", () => {
		const view = resolveView(TABLES.mbank, validateTableSearch({ sort: "nope", category: "x", threshold: "abc" }))
		assert.deepStrictEqual(view, { sort: "1m", desc: true, category: "akcyjny", period: null, threshold: 0 })
	})

	it("crypto: the period drives the default sort; threshold is kept", () => {
		const view = resolveView(TABLES.coingecko, validateTableSearch({ period: "7d", threshold: "20" }))
		assert.strictEqual(view.sort, "7d")
		assert.strictEqual(view.period, "7d")
		assert.strictEqual(view.threshold, 20)
	})

	it("funds: ?sort=mom&category=dłużny", () => {
		const view = resolveView(TABLES.mbank, validateTableSearch({ sort: "mom", category: "dłużny" }))
		assert.strictEqual(view.sort, "mom")
		assert.strictEqual(view.category, "dłużny")
	})
})
