import { assert, describe, it } from "@effect/vitest"
import type { CollectionRun } from "@fundstats/shared/api"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"

import { isStale } from "#/server/api/handlers.ts"
import { resolveView, validateTableSearch } from "#/web/search.ts"
import { TABLES } from "#/web/tables/index.ts"

const run = (status: CollectionRun["status"], startedAt: DateTime.Utc): CollectionRun => ({
	id: 1,
	status,
	trigger: "schedule",
	startedAt: DateTime.formatIso(startedAt),
	finishedAt: DateTime.formatIso(startedAt),
	instrumentCount: 1,
	rowsWritten: 1,
	error: null,
})

describe("staleness", () => {
	const at = DateTime.makeUnsafe("2026-11-16T12:00:00Z")
	const now = DateTime.toEpochMillis(at)
	const minutesAgo = (minutes: number) => DateTime.subtract(at, { minutes })
	const interval = Duration.minutes(30)

	it("is fresh shortly after a success", () => {
		const ok = run("success", minutesAgo(20))
		assert.isFalse(isStale({ lastRun: ok, lastSuccess: ok }, interval, now))
	})

	it("is stale after a failed run, even with older data", () => {
		const ok = run("success", minutesAgo(20))
		assert.isTrue(isStale({ lastRun: run("failed", at), lastSuccess: ok }, interval, now))
	})

	it("is stale when the last success is more than two intervals old", () => {
		const ok = run("success", minutesAgo(70))
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
