// @vitest-environment happy-dom
/** The table as a visitor meets it: visible columns, sort order and aria-sort, the highlight, the keyboard. */
import { afterEach, assert, describe, it } from "@effect/vitest"
import type { SnapshotRow } from "@fundstats/shared/api"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { MarketTable } from "#/web/components/MarketTable.tsx"
import { DEFAULT_PREFS, isColumnVisible, type Prefs, withColumn } from "#/web/prefs.ts"
import { resolveView, type TableSearch } from "#/web/search.ts"
import { TABLES } from "#/web/tables.ts"

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const coin = (id: string, rank: number, change7d: number | null): SnapshotRow => ({
	instrumentId: rank,
	externalId: id,
	name: id.toUpperCase(),
	symbol: id.toUpperCase(),
	category: null,
	currency: "PLN",
	metadata: { marketCap: 1e9 * rank },
	capturedAt: "2026-11-18T05:00:00Z",
	asOf: null,
	value: 10 * rank,
	metrics: change7d === null ? { rank } : { rank, change_7d: change7d },
})

const ROWS = [coin("aaa", 1, 5), coin("bbb", 2, null), coin("ccc", 3, 45), coin("ddd", 4, -12)]

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
	act(() => root?.unmount())
	container?.remove()
	root = null
	container = null
})

const render = async (search: TableSearch, prefs: Prefs = DEFAULT_PREFS) => {
	const config = TABLES.coingecko
	const patches: Array<Partial<TableSearch>> = []
	const router = createRouter({
		routeTree: createRootRoute({
			component: () => (
				<MarketTable
					config={config}
					rows={ROWS}
					view={resolveView(config, search)}
					columns={config.columns.filter((c) => isColumnVisible(prefs, "coingecko", c.id))}
					prefs={prefs}
					sparklines={new Map([["aaa", [1, 2, 3]]])}
					asOf={null}
					allRows={ROWS}
					onSearch={(patch) => patches.push(patch)}
				/>
			),
		}),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	})
	container = document.createElement("div")
	document.body.append(container)
	await act(async () => {
		root = createRoot(container!)
		root.render(<RouterProvider router={router} />)
		await router.load()
	})
	const table = container.querySelector("table")!
	const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim())
	// The ticker itself; the phone layout adds the rank after it.
	const tickers = [...table.querySelectorAll("tbody a[data-row] .font-semibold")].map((a) => a.textContent)
	return { table, headers, tickers, patches }
}

describe("market table", () => {
	it("shows the visible columns, sorts by the URL's column with missing values last, and marks it", async () => {
		const { table, headers, tickers } = await render({ sort: "7d" })
		assert.deepStrictEqual(headers, [
			"#",
			"TICKER",
			"NAME",
			"PRICE PLN",
			"24H %",
			"7D %",
			"30D %",
			"200D %",
			"1Y %",
			"MKT CAP",
			"CHART",
		])
		assert.deepStrictEqual(tickers, ["CCC", "AAA", "DDD", "BBB"])
		const sorted = [...table.querySelectorAll("th[aria-sort]")]
		assert.strictEqual(sorted.length, 1)
		assert.strictEqual(sorted[0]!.getAttribute("aria-sort"), "descending")
		assert.strictEqual(sorted[0]!.textContent?.trim(), "7D %")

		const sparklines = [...table.querySelectorAll("tbody [role=img]")].map((el) => el.getAttribute("aria-label"))
		assert.include(sparklines, "Last 3 prices: +200,00%", "TanStack Charts draws the row's history")
		assert.include(sparklines, "Not enough history")

		const ascending = await render({ sort: "7d", dir: "asc" })
		assert.deepStrictEqual(ascending.tickers, ["DDD", "AAA", "CCC", "BBB"], "missing values stay last either way")
	})

	it("table settings: hidden columns and the sparkline toggle remove their cells", async () => {
		const prefs = { ...withColumn(DEFAULT_PREFS, "coingecko", "name", false), sparklines: false }
		const { table, headers } = await render({}, prefs)
		assert.notInclude(headers, "NAME")
		assert.notInclude(headers, "CHART")
		assert.strictEqual(table.querySelector("tbody tr")!.children.length, headers.length)
	})

	it("tints the highlight column's cell of rows above the threshold, and only those", async () => {
		const { table } = await render({ sort: "7d", threshold: 40 })
		const highlighted = [...table.querySelectorAll("tbody tr[data-highlighted]")]
		assert.strictEqual(highlighted.length, 1)
		assert.strictEqual(highlighted[0]!.querySelector("a .font-semibold")?.textContent, "CCC")
		const tinted = [...highlighted[0]!.querySelectorAll("td")].filter((td) => td.className.includes("bg-highlight"))
		assert.deepStrictEqual(
			tinted.map((td) => td.textContent),
			["+45,00%"],
		)
	})

	it("a column's one button opens its menu, which sorts; only the first row link is tabbable and arrows move between rows", async () => {
		const { table, patches } = await render({})
		const button = table.querySelector<HTMLButtonElement>('thead button[aria-label^="Market capitalisation"]')!
		assert.include(button.getAttribute("aria-label"), "sort and filter")
		await act(async () => button.click())
		const item = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === "Sort high to low",
		)!
		await act(async () => item.click())
		assert.deepStrictEqual(patches, [{ sort: "mcap", dir: "desc" }])

		const links = [...table.querySelectorAll<HTMLAnchorElement>("tbody a[data-row]")]
		assert.deepStrictEqual(
			links.map((a) => a.tabIndex),
			[0, -1, -1, -1],
		)
		act(() => links[0]!.focus())
		act(() => {
			links[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
		})
		assert.strictEqual(document.activeElement, links[1])
		assert.strictEqual(links[1]!.tabIndex, 0)
		assert.match(links[1]!.getAttribute("href") ?? "", /^\/crypto\/coingecko\/[a-z]+$/)
	})
})
