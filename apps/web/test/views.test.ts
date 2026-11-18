import { assert, describe, it } from "@effect/vitest"
import type { CollectionRun, SnapshotRow } from "@fundstats/shared/api"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"

import { isStale } from "#/server/api/handlers.ts"
import { countNoun, formatCompact, formatPercent, formatPrice } from "#/web/format.ts"
import { heatCap, heatStep } from "#/web/heat.ts"
import { coveredRanges, nearestWithin, pickRange, rebase, splitAtGaps, toPoints } from "#/web/history.ts"
import { riskScale } from "#/web/risk.ts"
import {
	filterRows,
	presetPatch,
	resolvePins,
	resolveView,
	sortPatch,
	togglePin,
	toggleRisk,
	validateTableSearch,
} from "#/web/search.ts"
import { TABLES } from "#/web/tables.ts"

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

const fund = (
	externalId: string,
	name: string,
	category: string,
	metadata: Record<string, unknown>,
	metrics: Record<string, number> = {},
): SnapshotRow => ({
	instrumentId: 1,
	externalId,
	name,
	symbol: externalId,
	category,
	currency: "PLN",
	metadata,
	capturedAt: "2026-11-18T05:00:00Z",
	asOf: "2026-11-17",
	value: 100,
	metrics,
})

const FUNDS = [
	fund("1", "Investor Zrównoważony", "mieszany", { riskScale: 3, umbrella: "Investor Parasol FIO" }),
	fund("2", "Skarbiec - TOP Brands", "akcyjny", { riskScale: 4, umbrella: "Skarbiec FIO" }),
	fund("3", "PKO Obligacji", "dłużny", {
		riskScale: 2,
		umbrella: "PKO Parasolowy - FIO",
		longName: "PKO Parasolowy FIO Subfundusz PKO Obligacji Długoterminowych",
	}),
	fund("4", "Skarbiec Akcji Małych Spółek", "akcyjny", { riskScale: 5, umbrella: "Skarbiec FIO" }),
]

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

describe("search params", () => {
	it("keeps known keys and drops empty, oversized or malformed values", () => {
		assert.deepStrictEqual(
			validateTableSearch({
				q: "  akcji ",
				dir: "sideways",
				sort: "",
				risk: "7,2,x,9,2,0,100",
				pin: "a,b,a,c,d,e,,f",
				family: "x".repeat(200),
				unknown: "kept out",
			}),
			{ q: "akcji", risk: "2,7,9", pin: "a,b,c,d,e,f" },
		)
	})

	it("accepts numbers the way a hand-edited link might give them", () => {
		assert.deepStrictEqual(validateTableSearch({ risk: 3, pin: 579 }), { risk: "3", pin: "579" })
	})

	it("falls back to the source defaults: funds by momentum, every category", () => {
		const view = resolveView(TABLES.mbank, validateTableSearch({ sort: "nope", category: "x", preset: "?" }), FUNDS)
		assert.strictEqual(view.preset.id, "impet")
		assert.strictEqual(view.sort, "mom")
		assert.isTrue(view.desc)
		assert.isNull(view.category)
		assert.deepStrictEqual(
			view.columns.map((c) => c.id),
			["mom", "1m", "3m", "6m", "1y", "risk", "price"],
		)
	})

	it("ignores a sort on a column the preset hides, and a family the data does not have", () => {
		const view = resolveView(TABLES.mbank, validateTableSearch({ sort: "5y", dir: "asc", family: "Nope TFI" }), FUNDS)
		assert.strictEqual(view.sort, "mom")
		assert.isTrue(view.desc)
		assert.isNull(view.family)
	})

	it("crypto: rank sorts ascending first; fund filters do not apply", () => {
		const view = resolveView(
			TABLES.coingecko,
			validateTableSearch({ sort: "rank", risk: "3", category: "akcyjny" }),
			[],
		)
		assert.strictEqual(view.sort, "rank")
		assert.isFalse(view.desc)
		assert.strictEqual(view.risk.size, 0)
		assert.isNull(view.category)
		assert.strictEqual(resolveView(TABLES.coingecko, {}, []).sort, "1y")
	})
})

describe("presets", () => {
	it("each crypto preset lists only periods its source stores", () => {
		for (const config of [TABLES.coingecko, TABLES.coinpaprika, TABLES.coinmarketcap]) {
			const stored = new Set(config.periods.map((c) => c.id))
			for (const preset of config.presets)
				assert.isTrue(
					preset.columns.every((id) => stored.has(id)),
					preset.id,
				)
		}
		assert.strictEqual(TABLES.coinpaprika.presets.length, 1)
	})

	it("switching keeps filters and a sort whose column stays visible", () => {
		const search = validateTableSearch({ sort: "1m", dir: "asc", category: "akcyjny", q: "sk" })
		const view = resolveView(TABLES.mbank, search, FUNDS)
		assert.deepStrictEqual(presetPatch(TABLES.mbank, view, "krotki"), { preset: "krotki", sort: "1m", dir: "asc" })
		// An implicit sort carries over too: Krótki sorts by 1m, which Impet also shows.
		const krotki = resolveView(TABLES.mbank, { preset: "krotki" }, FUNDS)
		assert.deepStrictEqual(presetPatch(TABLES.mbank, krotki, "impet"), { preset: undefined, sort: "1m", dir: "desc" })
	})

	it("switching drops a sort whose column disappears, and the param for the default preset", () => {
		const view = resolveView(TABLES.mbank, validateTableSearch({ preset: "dlugi", sort: "5y" }), FUNDS)
		assert.deepStrictEqual(presetPatch(TABLES.mbank, view, "impet"), {
			preset: undefined,
			sort: undefined,
			dir: undefined,
		})
	})

	it("sorting: a new column starts in its natural direction, the same column flips", () => {
		const view = resolveView(TABLES.mbank, {}, FUNDS)
		assert.deepStrictEqual(sortPatch(view, "name"), { sort: "name", dir: "asc" })
		assert.deepStrictEqual(sortPatch(view, "mom"), { sort: "mom", dir: "asc" })
		const flipped = resolveView(TABLES.mbank, { sort: "mom", dir: "asc" }, FUNDS)
		assert.deepStrictEqual(sortPatch(flipped, "mom"), { sort: undefined, dir: undefined })
	})
})

describe("filters", () => {
	const names = (search: Record<string, unknown>) =>
		filterRows(FUNDS, resolveView(TABLES.mbank, validateTableSearch(search), FUNDS)).map((row) => row.externalId)

	it("search ignores case and Polish diacritics and reads the long name", () => {
		assert.deepStrictEqual(names({ q: "zrownowazony" }), ["1"])
		assert.deepStrictEqual(names({ q: "DLUGOTERMINOWYCH" }), ["3"])
		assert.deepStrictEqual(names({ q: "skarbiec malych" }), ["4"])
	})

	it("category, risk levels and family combine", () => {
		assert.deepStrictEqual(names({ category: "akcyjny" }), ["2", "4"])
		assert.deepStrictEqual(names({ risk: "2,5" }), ["3", "4"])
		assert.deepStrictEqual(names({ family: "Skarbiec FIO", risk: "4" }), ["2"])
	})

	it("risk levels come from mBank's own scale in the rows, not from 1–7", () => {
		const rows = [
			fund("a", "A", "dłużny", { riskScale: 1, riskName: "bardzo niskie" }),
			fund("b", "B", "akcyjny", { riskScale: 4, riskName: "wysokie" }),
			fund("c", "C", "akcyjny", { riskScale: 4, riskName: "wysokie" }),
			fund("d", "D", "mieszany", { riskScale: 3 }),
			fund("e", "E", "mieszany", {}),
		]
		assert.deepStrictEqual(riskScale(rows), [
			{ level: 1, name: "bardzo niskie", short: "b. niskie", count: 1 },
			{ level: 3, name: "poziom 3", short: "poziom 3", count: 1 },
			{ level: 4, name: "wysokie", short: "wysokie", count: 2 },
		])
		// A level the data does not have (2, 7) is dropped like an unknown family.
		assert.deepStrictEqual([...resolveView(TABLES.mbank, validateTableSearch({ risk: "2,4,7" }), rows).risk], [4])
	})

	it("counts for one filter ignore that filter", () => {
		const view = resolveView(TABLES.mbank, { category: "akcyjny" }, FUNDS)
		assert.strictEqual(filterRows(FUNDS, view, "category").length, 4)
	})

	it("pins resolve against the source's rows before the cap of four", () => {
		const view = resolveView(TABLES.mbank, validateTableSearch({ pin: "gone,old,1,2,3,4" }), FUNDS)
		assert.deepStrictEqual(view.pins, ["1", "2", "3", "4"])
		assert.deepStrictEqual(resolvePins("x,3", FUNDS), ["3"])
	})

	it("pins cap at four; risk toggles stay sorted", () => {
		assert.strictEqual(togglePin(["a", "b", "c", "d"], "e"), "a,b,c,d")
		assert.strictEqual(togglePin(["a", "b"], "a"), "b")
		assert.isUndefined(togglePin(["a"], "a"))
		assert.strictEqual(toggleRisk(new Set([5, 2]), 3), "2,3,5")
	})
})

describe("heat", () => {
	it("uses fixed caps per kind and period", () => {
		assert.strictEqual(heatCap("fund", "1y"), 30)
		assert.strictEqual(heatCap("crypto", "1y"), 80)
		assert.strictEqual(heatCap("fund", "mom"), 15)
		assert.isNull(heatCap("crypto", "price"))
	})

	it("three steps each side, clamped; printed zero and missing are neutral", () => {
		assert.strictEqual(heatStep(0.4, 8), 1)
		assert.strictEqual(heatStep(4, 8), 2)
		assert.strictEqual(heatStep(-7.9, 8), -3)
		assert.strictEqual(heatStep(250, 8), 3)
		assert.strictEqual(heatStep(0.004, 8), 0)
		assert.strictEqual(heatStep(null, 8), 0)
	})

	it("washes exactly the cells that do not print as zero", () => {
		for (const value of [-0.005, 0.005, -0.0049, 0.0049, -0.125, 0.125, 1.005, -1.005]) {
			const printedZero = formatPercent(value) === "0,00%"
			assert.strictEqual(heatStep(value, 8) === 0, printedZero, String(value))
		}
		assert.strictEqual(formatPercent(-0.005), "\u22120,01%")
		assert.strictEqual(formatPercent(-0.125), "\u22120,13%")
		assert.strictEqual(heatStep(-0.005, 8), -1)
	})
})

describe("pl-PL numbers", () => {
	it("returns carry a sign, a decimal comma and a real minus", () => {
		assert.strictEqual(formatPercent(4.123), "+4,12%")
		assert.strictEqual(formatPercent(-0.7311), "−0,73%")
		assert.strictEqual(formatPercent(-0.001), "0,00%")
		assert.strictEqual(formatPercent(1088.87), "+1 088,87%")
		assert.strictEqual(formatPercent(3.2), "+3,20%")
	})

	it("prices: two decimals from 1, six significant digits below; narrow no-break grouping", () => {
		assert.strictEqual(formatPrice(1234.5), "1 234,50")
		assert.strictEqual(formatPrice(259340), "259 340,00")
		assert.strictEqual(formatPrice(0.123456789), "0,123457")
		assert.strictEqual(formatPrice(0.00000599), "0,00000599")
		assert.strictEqual(formatPrice(0.9999996), "1,00")
		assert.strictEqual(formatCompact(1_298_252_724_362), "1,3 bln")
	})

	it("Polish plural forms", () => {
		const forms = { one: "fundusz", few: "fundusze", many: "funduszy" }
		assert.deepStrictEqual(
			[1, 3, 5, 12, 22, 257].map((n) => countNoun(n, forms)),
			["fundusz", "fundusze", "funduszy", "funduszy", "fundusze", "funduszy"],
		)
	})
})

describe("history", () => {
	const day = (date: string, value: number) => ({ capturedAt: `${date}T06:00:00Z`, asOf: date, value })

	it("funds: one point per valuation date, oldest first, newest capture wins", () => {
		const points = toPoints("fund", [
			{ capturedAt: "2026-11-18T12:00:00Z", asOf: "2026-11-17", value: 2 },
			{ capturedAt: "2026-11-18T06:00:00Z", asOf: "2026-11-17", value: 1 },
			day("2026-11-16", 3),
			{ capturedAt: "2026-11-15T06:00:00Z", asOf: "2026-11-15", value: null },
		])
		assert.deepStrictEqual(
			points.map((p) => p.v),
			[3, 2],
		)
	})

	it("offers only ranges the plotted points span with two points in the window", () => {
		const points = toPoints("fund", [day("2026-11-17", 1), day("2026-11-03", 1), day("2026-10-01", 1)])
		assert.deepStrictEqual(
			coveredRanges(points).map((r) => r.id),
			["1m", "max"],
		)
		assert.strictEqual(pickRange(points, "1y"), "max")
		assert.strictEqual(pickRange(points, "1m"), "1m")
		// Spans a month, but only the newest point falls inside it.
		const sparse = toPoints("fund", [day("2026-11-17", 1), day("2026-10-01", 1)])
		assert.deepStrictEqual(
			coveredRanges(sparse).map((r) => r.id),
			["max"],
		)
		// A row without a price does not extend the coverage.
		const unpriced = toPoints("fund", [
			day("2026-11-17", 1),
			day("2026-11-03", 1),
			{ ...day("2026-01-01", 1), value: null },
		])
		assert.deepStrictEqual(
			coveredRanges(unpriced).map((r) => r.id),
			["max"],
		)
		assert.deepStrictEqual(
			coveredRanges(toPoints("fund", [day("2026-11-17", 1)])).map((r) => r.id),
			["max"],
		)
	})

	it("rebases to 100 at the first date every series has", () => {
		const a = toPoints("fund", [day("2026-11-03", 120), day("2026-11-02", 110), day("2026-11-01", 100)])
		const b = toPoints("fund", [day("2026-11-03", 60), day("2026-11-02", 50)])
		const result = rebase([a, b])!
		assert.deepStrictEqual(
			result.series.map((s) => s.map((p) => Math.round(p.v))),
			[
				[100, 109],
				[100, 120],
			],
		)
		assert.isNull(rebase([a, toPoints("fund", [day("2026-12-01", 1)])]))
	})

	it("rebases series that start on different days at an explicit, shared anchor", () => {
		// Fund A is valued on 13.11 (Friday) and 17.11; fund B starts on 16.11 (Monday).
		const a = toPoints("fund", [day("2026-11-17", 100), day("2026-11-13", 80)])
		const b = toPoints("fund", [day("2026-11-17", 50), day("2026-11-16", 40)])
		const result = rebase([a, b])!
		const base = Date.parse("2026-11-16T00:00:00Z")
		assert.strictEqual(result.base, base)
		assert.deepStrictEqual(result.series[0], [
			{ t: base, v: 100, observed: Date.parse("2026-11-13T00:00:00Z") },
			{ t: Date.parse("2026-11-17T00:00:00Z"), v: 125 },
		])
		assert.deepStrictEqual(result.series[1], [
			{ t: base, v: 100 },
			{ t: Date.parse("2026-11-17T00:00:00Z"), v: 125 },
		])
	})

	it("hover finds a value only within the gap bound; long silences split the line", () => {
		const points = toPoints("fund", [day("2026-11-17", 3), day("2026-11-13", 2), day("2026-10-01", 1)])
		const at = (date: string) => Date.parse(`${date}T00:00:00Z`)
		const fourDays = 4 * 86_400_000
		assert.strictEqual(nearestWithin(points, at("2026-11-16"), fourDays)?.v, 3)
		assert.isUndefined(nearestWithin(points, at("2026-10-20"), fourDays))
		assert.deepStrictEqual(
			splitAtGaps(points, 6 * 86_400_000).map((run) => run.map((p) => p.v)),
			[[1], [2, 3]],
		)
	})
})
