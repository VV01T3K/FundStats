import type { SnapshotRow } from "@fundstats/shared/api"

import { roundForDisplay } from "./format.ts"
import {
	type Column,
	columnOf,
	type Facet,
	type FacetParam,
	FUND_CATEGORIES,
	longName,
	MARKET_CAP_FLOORS,
	marketCap,
	type TableConfig,
	THRESHOLD_MAX,
} from "./tables.ts"

/**
 * URL search params of a source's views, shared by its table and its detail pages so "back" restores
 * the table. Validation is lenient: unknown or invalid values are dropped and the view falls back to
 * the source defaults, so a hand-edited link still opens the table.
 */
export interface TableSearch {
	/** Setting a param to undefined removes it from the URL. */
	readonly q?: string | undefined
	readonly sort?: string | undefined
	readonly dir?: "asc" | "desc" | undefined
	/** Fund categories shown, comma-separated, or `all`; funds default to the first category. */
	readonly category?: string | undefined
	/** Percent; 0 turns the highlight off. */
	readonly threshold?: number | undefined
	/** The percent column the highlight reads, when not the sorted one. */
	readonly hl?: string | undefined
	/** Funds: the risk levels shown, e.g. `2,3`. */
	readonly risk?: string | undefined
	/** Funds: the fund families (umbrellas) shown, `|`-separated (names contain commas). */
	readonly family?: string | undefined
	/** Crypto: coins under this market cap are hidden. */
	readonly mincap?: number | undefined
}

/** The longest search the header field accepts. */
export const MAX_QUERY = 100

const text = (value: unknown, max: number) => {
	const raw = typeof value === "number" ? String(value) : value
	if (typeof raw !== "string") return undefined
	const trimmed = raw.trim()
	return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined
}

export const validateTableSearch = (raw: Record<string, unknown>): TableSearch => {
	const out: { -readonly [K in keyof TableSearch]: TableSearch[K] } = {}
	const q = text(raw.q, MAX_QUERY)
	if (q) out.q = q
	const sort = text(raw.sort, 32)
	if (sort) out.sort = sort
	if (raw.dir === "asc" || raw.dir === "desc") out.dir = raw.dir
	const category = text(raw.category, 120)
	const categories = category?.split(",").filter((c) => FUND_CATEGORIES.some((known) => known.value === c))
	if (category === ALL) out.category = ALL
	else if (categories && categories.length > 0) out.category = categories.join(",")
	const threshold = Number(text(raw.threshold, 8))
	if (Number.isInteger(threshold) && threshold >= 0 && threshold <= THRESHOLD_MAX) out.threshold = threshold
	const hl = text(raw.hl, 16)
	if (hl) out.hl = hl
	const risk = text(raw.risk, 16)
	if (risk && /^[1-7](,[1-7])*$/.test(risk)) out.risk = risk
	const family = text(raw.family, 600)
	if (family) out.family = family
	const mincap = Number(text(raw.mincap, 16))
	if (MARKET_CAP_FLOORS.some((floor) => floor.value === mincap)) out.mincap = mincap
	return out
}

export interface ResolvedView {
	readonly sort: string
	readonly desc: boolean
	readonly q: string
	/** Per filterable column param, the values shown; absent = no filter. */
	readonly facets: Partial<Record<FacetParam, ReadonlySet<string>>>
	readonly threshold: number
	/** The percent column the threshold reads: the chosen one, else the sorted one, else the source's default. */
	readonly highlight: Column
	/** Crypto: the market-cap floor; null = none. */
	readonly minCap: number | null
}

const ALL = "all"

/** Applies the source's defaults to whatever the URL holds. */
/** Every column the table can filter by its values. */
export const facetColumns = (config: TableConfig) =>
	config.columns.filter((column): column is Column & { facet: Facet } => column.facet !== undefined)

const SEPARATOR: Record<FacetParam, string> = { category: ",", risk: ",", family: "|" }

/** Funds open on their first category; `?category=all` shows every one. */
const defaultFacet = (config: TableConfig, param: FacetParam): ReadonlySet<string> | undefined =>
	config.kind === "fund" && param === "category" ? new Set([FUND_CATEGORIES[0].value]) : undefined

const facetSelection = (config: TableConfig, param: FacetParam, raw: string | undefined) => {
	if (raw === ALL) return undefined
	if (raw === undefined) return defaultFacet(config, param)
	const values = raw.split(SEPARATOR[param]).filter(Boolean)
	return values.length > 0 ? new Set(values) : undefined
}

/** Applies the source's defaults to whatever the URL holds. */
export const resolveView = (config: TableConfig, search: TableSearch): ResolvedView => {
	const wanted = search.sort === undefined ? undefined : columnOf(config, search.sort)
	const sortColumn = wanted?.sortValue ? wanted : columnOf(config, config.defaultSort)!
	const dir = wanted?.sortValue && search.dir ? search.dir : sortColumn.firstDir
	const hl = search.hl === undefined ? undefined : columnOf(config, search.hl)
	const facets: Partial<Record<FacetParam, ReadonlySet<string>>> = {}
	for (const column of facetColumns(config)) {
		const selection = facetSelection(config, column.facet.param, search[column.facet.param])
		if (selection) facets[column.facet.param] = selection
	}
	return {
		sort: sortColumn.id,
		desc: dir === "desc",
		q: search.q ?? "",
		facets,
		threshold: search.threshold ?? config.defaultThreshold,
		highlight:
			hl?.kind === "percent" ? hl : sortColumn.kind === "percent" ? sortColumn : columnOf(config, config.defaultSort)!,
		minCap: config.kind === "crypto" ? (search.mincap ?? null) : null,
	}
}

/** The search change for sorting by `columnId`: a new column starts in its natural direction. */
export const sortPatch = (config: TableConfig, view: ResolvedView, columnId: string): Partial<TableSearch> => {
	const column = columnOf(config, columnId)
	if (!column?.sortValue) return {}
	const desc = view.sort === columnId ? !view.desc : column.firstDir === "desc"
	const isDefault = columnId === config.defaultSort && desc === (column.firstDir === "desc")
	return isDefault ? { sort: undefined, dir: undefined } : { sort: columnId, dir: desc ? "desc" : "asc" }
}

/** The search change for sorting by `columnId` in a chosen direction; the source default drops out. */
export const sortToPatch = (config: TableConfig, columnId: string, desc: boolean): Partial<TableSearch> => {
	const column = columnOf(config, columnId)
	if (!column?.sortValue) return {}
	const isDefault = columnId === config.defaultSort && desc === (column.firstDir === "desc")
	return isDefault ? { sort: undefined, dir: undefined } : { sort: columnId, dir: desc ? "desc" : "asc" }
}

/** The search change for picking one fund category in the bar (null: every category). */
export const categoryPatch = (config: TableConfig, value: string | null): Partial<TableSearch> =>
	facetPatch(config, "category", value === null ? null : new Set([value]))

/** The search change for toggling one value of a filterable column; all values on means no filter. */
export const toggleFacetPatch = (
	config: TableConfig,
	view: ResolvedView,
	param: FacetParam,
	value: string,
	allValues: ReadonlyArray<string>,
): Partial<TableSearch> => {
	const next = new Set(view.facets[param] ?? allValues)
	if (next.has(value)) next.delete(value)
	else next.add(value)
	return facetPatch(config, param, next.size === allValues.length ? null : next)
}

/** Clears the filters `extraFilters` counts. */
export const clearExtraFiltersPatch: Partial<TableSearch> = {
	risk: undefined,
	family: undefined,
	mincap: undefined,
}

/** How many filters set outside the bar's own controls are on (the bar's chip counts and clears them). */
export const extraFilters = (view: ResolvedView) =>
	[view.facets.risk, view.facets.family, view.minCap ?? undefined].filter((f) => f !== undefined).length

/** The search change for showing only `values` of a filterable column (empty or null: no filter). */
export const facetPatch = (
	config: TableConfig,
	param: FacetParam,
	values: ReadonlySet<string> | null,
): Partial<TableSearch> => {
	const fallback = defaultFacet(config, param)
	if (values === null || values.size === 0) return { [param]: fallback ? ALL : undefined }
	const same = fallback !== undefined && fallback.size === values.size && [...values].every((v) => fallback.has(v))
	return { [param]: same ? undefined : [...values].join(SEPARATOR[param]) }
}

/** The search change for highlighting rows above `threshold` in `column` (0 turns it off). */
export const highlightPatch = (config: TableConfig, columnId: string, threshold: number): Partial<TableSearch> => {
	if (threshold === 0) return { threshold: config.defaultThreshold === 0 ? undefined : 0, hl: undefined }
	const isDefault = columnId === config.defaultSort && threshold === config.defaultThreshold
	return isDefault ? { threshold: undefined, hl: undefined } : { threshold, hl: columnId }
}

/** The market-cap floor's search change; null removes it. */
export const minCapPatch = (value: number | null): Partial<TableSearch> => ({ mincap: value ?? undefined })

/** Clears every filter (the highlight is not one): every fund category, every risk and family, any cap. */
export const clearFiltersPatch = (config: TableConfig): Partial<TableSearch> => ({
	...Object.fromEntries(
		facetColumns(config).map((column) => [
			column.facet.param,
			defaultFacet(config, column.facet.param) ? ALL : undefined,
		]),
	),
	mincap: undefined,
})

/** Whether any filter narrows the rows. */
export const hasFilters = (view: ResolvedView) => Object.keys(view.facets).length > 0 || view.minCap !== null

/** Lower-case, without Polish diacritics, so "zrownowazony" finds "Zrównoważony". */
const fold = (value: string) =>
	value
		.toLocaleLowerCase("pl-PL")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replaceAll("ł", "l")

/** Rows passing the view's column filters whose name, ticker or long name contain every search word. */
export const filterRows = (config: TableConfig, rows: ReadonlyArray<SnapshotRow>, view: ResolvedView) => {
	const columns = facetColumns(config)
	const terms = fold(view.q).split(/\s+/).filter(Boolean)
	return rows.filter((row) => {
		for (const column of columns) {
			const selected = view.facets[column.facet.param]
			if (selected && !selected.has(column.facet.value(row) ?? "")) return false
		}
		if (view.minCap !== null && (marketCap(row) ?? 0) < view.minCap) return false
		if (terms.length === 0) return true
		const haystack = fold([row.name, row.symbol ?? "", longName(row) ?? ""].join(" "))
		return terms.every((term) => haystack.includes(term))
	})
}

/** True when the row's highlight value, as printed, is above the threshold. */
export const isHighlighted = (view: ResolvedView, row: SnapshotRow) => {
	if (view.threshold <= 0) return false
	const value = view.highlight.sortValue?.(row)
	return typeof value === "number" && roundForDisplay(value) > view.threshold
}
