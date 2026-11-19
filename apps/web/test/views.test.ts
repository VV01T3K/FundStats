import { assert, describe, it } from "@effect/vitest"
import type { CollectionRun, SnapshotRow, SourceStatus } from "@fundstats/shared/api"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"

import { isStale } from "#/server/api/handlers.ts"
import {
	formatCompact,
	formatDate,
	formatPercent,
	formatPrice,
	formatStamp,
	roundForDisplay,
	trend,
} from "#/web/format.ts"
import { sourceState, stateLabel, tableAsOf } from "#/web/freshness.ts"
import { DEFAULT_PREFS, isColumnVisible, parsePrefs, prefsCookie, readPrefsCookie, withColumn } from "#/web/prefs.ts"
import {
	clearFiltersPatch,
	facetPatch,
	filterRows,
	hasFilters,
	highlightPatch,
	isHighlighted,
	resolveView,
	sortPatch,
	validateTableSearch,
} from "#/web/search.ts"
import { TABLES } from "#/web/tables.ts"
import { parseSearch, stringifySearch } from "#/web/url.ts"

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

const row = (
	externalId: string,
	fields: Partial<Omit<SnapshotRow, "externalId">> = {},
	metrics: Record<string, number> = {},
): SnapshotRow => ({
	instrumentId: 1,
	externalId,
	name: externalId,
	symbol: null,
	category: null,
	currency: "PLN",
	metadata: {},
	capturedAt: "2026-11-18T05:00:00Z",
	asOf: null,
	value: 1,
	metrics,
	...fields,
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

	it("labels fresh crypto live, fresh funds cached for their interval, the rest stale or empty", () => {
		const ok = run("success", at)
		const status = (kind: "fund" | "crypto", stale: boolean, lastSuccess: CollectionRun | null): SourceStatus => ({
			id: kind === "fund" ? "mbank" : "coingecko",
			name: "x",
			kind,
			currency: "PLN",
			intervalSeconds: 6 * 3600,
			lastRun: lastSuccess,
			lastSuccess,
			stale,
		})
		assert.strictEqual(stateLabel(status("crypto", false, ok)), "LIVE")
		assert.strictEqual(stateLabel(status("fund", false, ok)), "CACHED 06H")
		assert.strictEqual(stateLabel(status("fund", true, ok)), "STALE")
		assert.strictEqual(sourceState(status("crypto", true, null)), "empty")
	})

	it("the table's valuation date is the one most rows share", () => {
		const rows = [row("a", { asOf: "2026-11-17" }), row("b", { asOf: "2026-11-17" }), row("c", { asOf: "2026-11-18" })]
		assert.strictEqual(tableAsOf(rows), "2026-11-17")
		assert.isNull(tableAsOf([row("btc")]))
	})
})

describe("search params", () => {
	it("keeps known keys and drops empty, oversized or malformed values", () => {
		assert.deepStrictEqual(
			validateTableSearch({ q: "  btc  ", sort: "7d", dir: "up", category: "", threshold: "abc", extra: 1 }),
			{ q: "btc", sort: "7d" },
		)
		assert.deepStrictEqual(validateTableSearch({ q: "x".repeat(101), threshold: "150" }), {})
		assert.deepStrictEqual(validateTableSearch({ threshold: "35", dir: "asc" }), { threshold: 35, dir: "asc" })
	})

	it("serializes plain key=value pairs and reads them back", () => {
		const text = stringifySearch({ q: "pko obligacji", threshold: 40, sort: undefined, category: "dłużny" })
		assert.strictEqual(text, "?q=pko+obligacji&threshold=40&category=d%C5%82u%C5%BCny")
		assert.deepStrictEqual(validateTableSearch(parseSearch(text)), {
			q: "pko obligacji",
			threshold: 40,
			category: "dłużny",
		})
	})

	it("falls back to the source defaults: funds by 1M in the equity category, crypto by its period", () => {
		const funds = resolveView(TABLES.mbank, validateTableSearch({ sort: "nope", category: "x" }))
		assert.include(funds, { sort: "1m", desc: true, threshold: 0 })
		assert.deepStrictEqual([...funds.facets.category!], ["akcyjny"])
		assert.strictEqual(funds.highlight.id, "1m")
		const coins = resolveView(TABLES.coinmarketcap, {})
		assert.include(coins, { sort: "30d", desc: true, threshold: 40 })
		assert.deepStrictEqual(coins.facets, {})
	})

	it("the highlight reads the sorted column when it is a change, else the default period", () => {
		assert.strictEqual(resolveView(TABLES.coingecko, { sort: "7d" }).highlight.id, "7d")
		assert.strictEqual(resolveView(TABLES.coingecko, { sort: "price" }).highlight.id, "1y")
		assert.strictEqual(resolveView(TABLES.coingecko, { sort: "rank" }).desc, false, "rank sorts ascending first")
	})

	it("sorting: a new column starts in its natural direction, the same column flips, the default drops from the URL", () => {
		const config = TABLES.mbank
		const view = resolveView(config, {})
		assert.deepStrictEqual(sortPatch(config, view, "name"), { sort: "name", dir: "asc" })
		assert.deepStrictEqual(sortPatch(config, view, "1m"), { sort: "1m", dir: "asc" })
		const flipped = resolveView(config, { sort: "1m", dir: "asc" })
		assert.deepStrictEqual(sortPatch(config, flipped, "1m"), { sort: undefined, dir: undefined })
		assert.deepStrictEqual(sortPatch(config, view, "position"), {}, "the position column does not sort")
	})

	it("filter and highlight patches leave defaults out of the URL", () => {
		const funds = TABLES.mbank
		assert.deepStrictEqual(facetPatch(funds, "category", new Set(["akcyjny"])), { category: undefined })
		assert.deepStrictEqual(facetPatch(funds, "category", null), { category: "all" })
		assert.deepStrictEqual(facetPatch(funds, "category", new Set(["akcyjny", "dłużny"])), {
			category: "akcyjny,dłużny",
		})
		assert.isUndefined(resolveView(funds, { category: "all" }).facets.category)
		assert.deepStrictEqual(facetPatch(funds, "family", new Set(["A, B", "C"])), { family: "A, B|C" })
		assert.deepStrictEqual(highlightPatch(TABLES.coingecko, "1y", 50), { threshold: undefined, hl: undefined })
		assert.deepStrictEqual(highlightPatch(TABLES.coingecko, "7d", 20), { threshold: 20, hl: "7d" })
		assert.deepStrictEqual(highlightPatch(TABLES.coingecko, "7d", 0), { threshold: 0, hl: undefined })
		assert.deepStrictEqual(validateTableSearch({ category: "akcyjny,nope" }), { category: "akcyjny" })
	})
})

describe("filters and highlight", () => {
	const funds = [
		row("1", { name: "PKO Zrównoważony", category: "mieszany", metadata: { longName: "PKO Zrównoważony FIO" } }),
		row("2", { name: "Generali Obligacji", category: "dłużny" }),
		row("3", { name: "Investor Akcji", category: "akcyjny" }),
	]

	it("search ignores case and Polish diacritics, needs every word and reads the long name", () => {
		const view = resolveView(TABLES.mbank, { category: "all", q: "zrownowazony fio" })
		assert.deepStrictEqual(
			filterRows(TABLES.mbank, funds, view).map((r) => r.externalId),
			["1"],
		)
	})

	it("the category filter applies on top of the search", () => {
		const view = resolveView(TABLES.mbank, { category: "dłużny" })
		assert.deepStrictEqual(
			filterRows(TABLES.mbank, funds, view).map((r) => r.externalId),
			["2"],
		)
	})

	it("highlights rows whose printed value is above the threshold, never at it", () => {
		const view = resolveView(TABLES.coingecko, { threshold: 40 })
		const coin = (change: number) => row("c", {}, { change_1y: change })
		assert.isTrue(isHighlighted(view, coin(40.006)))
		assert.isFalse(isHighlighted(view, coin(40.004)), "prints as +40,00%")
		assert.isFalse(isHighlighted(view, coin(-80)), "losses are not highlights")
		assert.isFalse(isHighlighted(resolveView(TABLES.coingecko, { threshold: 0 }), coin(500)), "0 turns it off")
		assert.isFalse(isHighlighted(view, row("none")), "a missing value is not above anything")
	})
	it("column filters: fund risk levels and families, crypto market-cap floor", () => {
		const risky = [
			row("a", { metadata: { riskScale: 2, umbrella: "PKO" } }),
			row("b", { metadata: { riskScale: 4, umbrella: "PKO" } }),
			row("c", { metadata: { riskScale: 4, umbrella: "Investor, Inc" } }),
		]
		const funds = TABLES.mbank
		const view = (search: Record<string, string>) =>
			resolveView(funds, validateTableSearch({ category: "all", ...search }))
		assert.deepStrictEqual(
			filterRows(funds, risky, view({ risk: "4" })).map((r) => r.externalId),
			["b", "c"],
		)
		const both = view({ risk: "4", family: "PKO|Investor, Inc" })
		assert.deepStrictEqual(
			filterRows(funds, risky, both).map((r) => r.externalId),
			["b", "c"],
		)
		assert.isTrue(hasFilters(both))
		assert.deepStrictEqual(clearFiltersPatch(funds), {
			category: "all",
			risk: undefined,
			family: undefined,
			mincap: undefined,
		})

		const coins = [
			row("big", { metadata: { marketCap: 2e10 } }),
			row("small", { metadata: { marketCap: 5e8 } }),
			row("none"),
		]
		const floor = resolveView(TABLES.coingecko, validateTableSearch({ mincap: "1000000000" }))
		assert.deepStrictEqual(
			filterRows(TABLES.coingecko, coins, floor).map((r) => r.externalId),
			["big"],
		)
		assert.isUndefined(validateTableSearch({ mincap: "12345" }).mincap, "only the offered floors")
		assert.isNull(resolveView(funds, { mincap: 1e9 }).minCap, "funds have no market cap")
	})

	it("the highlight can read a chosen percent column instead of the sorted one", () => {
		const view = resolveView(TABLES.coingecko, { hl: "7d", threshold: 10 })
		assert.strictEqual(view.highlight.id, "7d")
		assert.isTrue(isHighlighted(view, row("c", {}, { change_7d: 12, change_1y: 0 })))
		assert.strictEqual(resolveView(TABLES.coingecko, { hl: "mcap" }).highlight.id, "1y", "not a percent column")
		assert.deepStrictEqual(TABLES.coinpaprika.thresholds, [5, 10, 20, 30, 40, 50])
	})
})

describe("table settings", () => {
	it("columns follow their defaults until the viewer turns them on or off; required ones stay", () => {
		assert.isTrue(isColumnVisible(DEFAULT_PREFS, "mbank", "1m"))
		assert.isFalse(isColumnVisible(DEFAULT_PREFS, "mbank", "3y"))
		const prefs = withColumn(withColumn(DEFAULT_PREFS, "mbank", "3y", true), "mbank", "1m", false)
		assert.isTrue(isColumnVisible(prefs, "mbank", "3y"))
		assert.isFalse(isColumnVisible(prefs, "mbank", "1m"))
		assert.isTrue(isColumnVisible(withColumn(DEFAULT_PREFS, "mbank", "name", false), "mbank", "name"))
		assert.isFalse(isColumnVisible(prefs, "coingecko", "nope"))
	})

	it("round-trips through the cookie, and anything unknown or malformed takes its default", () => {
		const prefs = {
			...withColumn(DEFAULT_PREFS, "coinpaprika", "name", false),
			density: "compact",
			theme: "classic",
			layout: "floating",
			showSoon: false,
		} as const
		const cookie = prefsCookie(prefs)
		assert.match(cookie, /; Path=\/; Max-Age=31536000; SameSite=Lax$/)
		assert.deepStrictEqual(parsePrefs(readPrefsCookie(`other=1; ${cookie.split(";")[0]}`)), prefs)
		assert.deepStrictEqual(parsePrefs(undefined), DEFAULT_PREFS)
		assert.deepStrictEqual(parsePrefs("%7Bbroken"), DEFAULT_PREFS)
		assert.deepStrictEqual(
			parsePrefs(
				encodeURIComponent(
					JSON.stringify({
						density: "huge",
						sparklines: "yes",
						theme: "neon",
						layout: "wide",
						showSoon: "no",
						columns: { mbank: { name: false, "3y": true, x: true } },
					}),
				),
			),
			{ ...DEFAULT_PREFS, columns: { mbank: { "3y": true } } },
		)
	})
})

describe("pl-PL numbers and Warsaw time", () => {
	it("returns carry a sign, a decimal comma and a real minus", () => {
		assert.strictEqual(formatPercent(9.15), "+9,15%")
		assert.strictEqual(formatPercent(-4.51), "−4,51%")
		assert.strictEqual(formatPercent(0.004), "0,00%")
		assert.strictEqual(formatPercent(1234.5), "+1\u00a0234,50%")
	})

	it("ties round away from zero on the decimal the source printed; colour follows the printed value", () => {
		assert.strictEqual(roundForDisplay(2.675), 2.68)
		assert.strictEqual(roundForDisplay(-2.675), -2.68)
		assert.strictEqual(formatPercent(-0.005), "−0,01%")
		assert.strictEqual(trend(-0.005), "down")
		assert.strictEqual(trend(0.004), "flat")
	})

	it("prices: two decimals from 1, six significant digits below; no-break grouping", () => {
		assert.strictEqual(formatPrice(412840), "412\u00a0840,00")
		assert.strictEqual(formatPrice(0.000123456789), "0,000123457")
		assert.strictEqual(formatPrice(0.9999999), "1,00")
	})

	it("market caps use the terminal's short scale with a decimal comma", () => {
		assert.strictEqual(formatCompact(8.14e12), "8,14T")
		assert.strictEqual(formatCompact(384e9), "384,00B")
		assert.strictEqual(formatCompact(600e6), "600,00M")
		assert.strictEqual(formatCompact(512), "512")
	})

	it("dates and times are Warsaw's, winter and summer time alike", () => {
		assert.strictEqual(formatDate("2026-11-17"), "17.11.2026")
		assert.strictEqual(formatStamp("2026-11-18T05:02:00Z"), "18.11.2026, 06:02")
		assert.strictEqual(formatStamp("2026-07-18T05:02:00Z"), "18.07.2026, 07:02")
	})
})
