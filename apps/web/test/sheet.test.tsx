// @vitest-environment happy-dom
/** The sheet as a visitor meets it: sort order and aria-sort, the keyboard, and presets read from the URL. */
import { afterEach, assert, describe, it } from "@effect/vitest"
import type { SnapshotRow } from "@fundstats/shared/api"
import type { SourceStatus } from "@fundstats/shared/api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRoute,
	createRootRouteWithContext,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { TooltipProvider } from "#/components/ui/tooltip"
import { Route as IndexRoute } from "#/routes/$kind.$source.index.tsx"
import { Route as SourceRoute } from "#/routes/$kind.$source.tsx"
import { latestQuery } from "#/web/api.ts"
import { Sheet } from "#/web/components/Sheet.tsx"
import { riskScale } from "#/web/risk.ts"
import { resolveView, validateTableSearch } from "#/web/search.ts"
import { TABLES } from "#/web/tables.ts"

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const fund = (externalId: string, name: string, change1m: number | null, risk = 4): SnapshotRow => ({
	instrumentId: Number(externalId),
	externalId,
	name,
	symbol: externalId,
	category: "akcyjny",
	currency: "PLN",
	metadata: { riskScale: risk, riskName: risk === 1 ? "bardzo niskie" : "wysokie", umbrella: "Test FIO" },
	capturedAt: "2026-11-18T05:00:00Z",
	asOf: "2026-11-17",
	value: 100,
	metrics: change1m === null ? {} : { change_1m: change1m },
})

const ROWS = [fund("1", "Alfa", 5, 1), fund("2", "Beta", null), fund("3", "Gamma", -2), fund("4", "Delta", 3)]

interface Calls {
	readonly opened: Array<string>
	readonly pinned: Array<string>
}

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
	act(() => root?.unmount())
	container?.remove()
	root = null
	container = null
})

const render = async (search: Record<string, unknown>): Promise<{ table: HTMLTableElement; calls: Calls }> => {
	const calls: Calls = { opened: [], pinned: [] }
	const view = resolveView(TABLES.mbank, validateTableSearch(search), ROWS)
	const router = createRouter({
		routeTree: createRootRoute({
			component: () => (
				<TooltipProvider>
					<Sheet
						config={TABLES.mbank}
						rows={ROWS}
						view={view}
						search={{}}
						asOf="2026-11-17"
						onSort={() => {}}
						onTogglePin={(id) => calls.pinned.push(id)}
						onOpen={(id) => calls.opened.push(id)}
						empty={null}
						risk={riskScale(ROWS)}
					/>
				</TooltipProvider>
			),
		}),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	})
	await router.load()
	container = document.createElement("div")
	document.body.append(container)
	const mount = createRoot(container)
	root = mount
	await act(async () => mount.render(<RouterProvider router={router} />))
	return { table: container.querySelector("table")!, calls }
}

const names = (table: HTMLTableElement) =>
	[...table.querySelectorAll("tbody tr")].map((row) => row.querySelector("a")?.textContent)
const header = (table: HTMLTableElement, label: string) =>
	[...table.querySelectorAll("thead th")].find((th) => th.textContent?.trim() === label)
const press = (target: Element, key: string) =>
	act(() => {
		target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
	})

describe("Sheet", () => {
	it("sorts a column with gaps: values in order, missing last in both directions, aria-sort on the header", async () => {
		const desc = await render({ sort: "1m", dir: "desc" })
		assert.deepStrictEqual(names(desc.table), ["Alfa", "Delta", "Gamma", "Beta"])
		assert.strictEqual(header(desc.table, "1m")?.getAttribute("aria-sort"), "descending")
		assert.isNull(header(desc.table, "3m")?.getAttribute("aria-sort") ?? null)
		act(() => root?.unmount())

		const asc = await render({ sort: "1m", dir: "asc" })
		assert.deepStrictEqual(names(asc.table), ["Gamma", "Delta", "Alfa", "Beta"])
		assert.strictEqual(header(asc.table, "1m")?.getAttribute("aria-sort"), "ascending")
	})

	it("j/k move the row focus, Enter opens the row, p pins it; the focused row's link and pin are tabbable", async () => {
		const { table, calls } = await render({ sort: "name", dir: "asc" })
		const rows = [...table.querySelectorAll<HTMLElement>("tbody tr")]
		act(() => rows[0]!.focus())
		await press(rows[0]!, "j")
		assert.strictEqual(document.activeElement, rows[1])
		await press(rows[1]!, "ArrowDown")
		assert.strictEqual(document.activeElement, rows[2])
		await press(rows[2]!, "k")
		assert.strictEqual(document.activeElement, rows[1])
		await press(rows[1]!, "Enter")
		await press(rows[1]!, "p")
		assert.deepStrictEqual(calls.opened, ["2"])
		assert.deepStrictEqual(calls.pinned, ["2"])
		assert.strictEqual(rows[1]!.querySelector("a")!.tabIndex, 0)
		assert.strictEqual(rows[1]!.querySelector("button")!.tabIndex, 0)
		assert.strictEqual(rows[0]!.querySelector("a")!.tabIndex, -1)
	})

	it("names each fund's level on mBank's scale instead of printing a bare number", async () => {
		const { table } = await render({ sort: "name", dir: "asc" })
		const column = [...table.querySelectorAll("thead th")].findIndex((th) => th.textContent?.trim() === "Ryzyko")
		const cells = [...table.querySelectorAll("tbody tr")].map((row) => row.children[column]!)
		const shown = (cell: Element) =>
			[...cell.querySelectorAll(":scope > span > span")].find((s) => !s.classList.contains("sr-only"))?.textContent
		assert.deepStrictEqual(cells.map(shown), ["b. niskie", "wysokie", "wysokie", "wysokie"])
		// The abbreviation's full name reaches screen readers, and the focused row's label takes focus for its tooltip.
		assert.strictEqual(cells[0]!.querySelector(".sr-only")?.textContent, "bardzo niskie")
		assert.strictEqual(cells[0]!.querySelector<HTMLElement>("[tabindex]")?.tabIndex, 0)
		assert.isNull(cells[1]!.querySelector(".sr-only"))
	})
})

const STATUS: SourceStatus = {
	id: "mbank",
	name: "mBank",
	kind: "fund",
	currency: "PLN",
	intervalSeconds: 21_600,
	lastRun: null,
	lastSuccess: null,
	stale: false,
}

/** The table page as the router serves it, its data already in the query cache. */
const renderPage = async (url: string) => {
	const queryClient = new QueryClient()
	queryClient.setQueryData(latestQuery("mbank").queryKey, { source: STATUS, rows: ROWS })
	const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<Outlet />
				</TooltipProvider>
			</QueryClientProvider>
		),
		notFoundComponent: () => <p data-not-found />,
	})
	// Attached the way routeTree.gen.ts does it; `update`'s options type leaves out id, path and parent.
	const sourceRoute = SourceRoute.update({
		id: "/$kind/$source",
		path: "/$kind/$source",
		getParentRoute: () => rootRoute,
	} as Parameters<typeof SourceRoute.update>[0])
	const indexRoute = IndexRoute.update({
		id: "/",
		path: "/",
		getParentRoute: () => sourceRoute,
	} as Parameters<typeof IndexRoute.update>[0])
	const router = createRouter({
		routeTree: rootRoute.addChildren([sourceRoute.addChildren([indexRoute])]),
		context: { queryClient },
		history: createMemoryHistory({ initialEntries: [url] }),
	})
	await router.load()
	container = document.createElement("div")
	document.body.append(container)
	const mount = createRoot(container)
	root = mount
	await act(async () => mount.render(<RouterProvider router={router} />))
	return { page: container, router }
}

describe("table page", () => {
	it("a preset click changes the URL and the columns, and keeps the filters", async () => {
		const { page, router } = await renderPage("/funds/mbank?category=akcyjny&risk=4")
		const preset = [...page.querySelectorAll<HTMLButtonElement>('[aria-label="Zestaw kolumn"] button')].find(
			(button) => button.textContent === "Długi",
		)!
		await act(async () => preset.click())
		assert.deepStrictEqual(router.state.location.search, { category: "akcyjny", risk: "4", preset: "dlugi" })
		const table = page.querySelector("table")!
		const labels = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim()).filter(Boolean)
		assert.deepStrictEqual(labels, ["Nazwa", "1r", "3l", "5l", "Od startu", "Ryzyko", "Wartość j.u. PLN"])
		assert.strictEqual(header(table, "1r")?.getAttribute("aria-sort"), "descending")
		// Alfa is "bardzo niskie" (level 1), so the risk filter still leaves it out.
		assert.deepStrictEqual(names(table).toSorted(), ["Beta", "Delta", "Gamma"])
	})

	it.each(["/funds/unknown", "/crypto/mbank"])("%s is the router's 404", async (url) => {
		const { page } = await renderPage(url)
		assert.isNotNull(page.querySelector("[data-not-found]"))
		assert.isNull(page.querySelector("table"))
	})
})
