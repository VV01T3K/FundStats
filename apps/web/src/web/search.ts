import type { SnapshotRow } from "@fundstats/shared/api"

import { roundForDisplay } from "./format.ts"
import {
	type Column,
	columnOf,
	FUND_CATEGORIES,
	fundFamily,
	fundRisk,
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
	/** A fund category value, or `all`. */
	readonly category?: string | undefined
	/** Percent; 0 turns the highlight off. */
	readonly threshold?: number | undefined
	/** The percent column the highlight reads, when not the sorted one. */
	readonly hl?: string | undefined
	/** Funds: the risk levels shown, e.g. `2,3`. */
	readonly risk?: string | undefined
	/** Funds: the one fund family (umbrella) shown. */
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
	const category = text(raw.category, 64)
	if (category) out.category = category
	const threshold = Number(text(raw.threshold, 8))
	if (Number.isInteger(threshold) && threshold >= 0 && threshold <= THRESHOLD_MAX) out.threshold = threshold
	const hl = text(raw.hl, 16)
	if (hl) out.hl = hl
	const risk = text(raw.risk, 16)
	if (risk && /^[1-7](,[1-7])*$/.test(risk)) out.risk = risk
	const family = text(raw.family, 80)
	if (family) out.family = family
	const mincap = Number(text(raw.mincap, 16))
	if (MARKET_CAP_FLOORS.some((floor) => floor.value === mincap)) out.mincap = mincap
	return out
}

export interface ResolvedView {
	readonly sort: string
	readonly desc: boolean
	readonly q: string
	/** null = every category; always null for crypto. */
	readonly category: string | null
	readonly threshold: number
	/** The percent column the threshold reads: the chosen one, else the sorted one, else the source's default. */
	readonly highlight: Column
	/** Whether `highlight` was chosen (?hl) rather than following the sort. */
	readonly highlightChosen: boolean
	/** Funds: the risk levels shown; null = all. */
	readonly risks: ReadonlySet<number> | null
	/** Funds: the fund family shown; null = all. */
	readonly family: string | null
	/** Crypto: the market-cap floor; null = none. */
	readonly minCap: number | null
}

const ALL = "all"

/** Applies the source's defaults to whatever the URL holds. */
export const resolveView = (config: TableConfig, search: TableSearch): ResolvedView => {
	const wanted = search.sort === undefined ? undefined : columnOf(config, search.sort)
	const sortColumn = wanted?.sortValue ? wanted : columnOf(config, config.defaultSort)!
	const dir = wanted?.sortValue && search.dir ? search.dir : sortColumn.firstDir
	const known = FUND_CATEGORIES.some((c) => c.value === search.category)
	const hl = search.hl === undefined ? undefined : columnOf(config, search.hl)
	const chosen = hl?.kind === "percent" ? hl : undefined
	return {
		sort: sortColumn.id,
		desc: dir === "desc",
		q: search.q ?? "",
		category:
			config.kind !== "fund" || search.category === ALL ? null : known ? search.category! : FUND_CATEGORIES[0].value,
		threshold: search.threshold ?? config.defaultThreshold,
		highlight: chosen ?? (sortColumn.kind === "percent" ? sortColumn : columnOf(config, config.defaultSort)!),
		highlightChosen: chosen !== undefined,
		risks: config.kind === "fund" && search.risk ? new Set(search.risk.split(",").map(Number)) : null,
		family: config.kind === "fund" ? (search.family ?? null) : null,
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

/** The search change for picking a category; `all` is explicit because funds default to one category. */
export const categoryPatch = (value: string | null): Partial<TableSearch> => ({
	category: value === FUND_CATEGORIES[0].value ? undefined : (value ?? ALL),
})

export const thresholdPatch = (config: TableConfig, threshold: number): Partial<TableSearch> => ({
	threshold: threshold === config.defaultThreshold ? undefined : threshold,
})

/** The risk levels shown after toggling `level` (null = all of them). */
export const riskPatch = (view: ResolvedView, level: number, levels: ReadonlyArray<number>): Partial<TableSearch> => {
	const current = new Set(view.risks ?? levels)
	if (current.has(level)) current.delete(level)
	else current.add(level)
	const kept = levels.filter((l) => current.has(l))
	return { risk: kept.length === 0 || kept.length === levels.length ? undefined : kept.join(",") }
}

/** How many of the drawer's per-source filters are in effect. */
export const activeFilters = (view: ResolvedView) =>
	[view.risks !== null, view.family !== null, view.minCap !== null].filter(Boolean).length

/** Clears the drawer's per-source filters. */
export const clearFiltersPatch: Partial<TableSearch> = { risk: undefined, family: undefined, mincap: undefined }

/** Lower-case, without Polish diacritics, so "zrownowazony" finds "Zrównoważony". */
const fold = (value: string) =>
	value
		.toLocaleLowerCase("pl-PL")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replaceAll("ł", "l")

/** Rows passing the view's category and drawer filters whose name, ticker or long name contain every search word. */
export const filterRows = (rows: ReadonlyArray<SnapshotRow>, view: ResolvedView) => {
	const terms = fold(view.q).split(/\s+/).filter(Boolean)
	return rows.filter((row) => {
		if (view.category !== null && row.category !== view.category) return false
		if (view.risks !== null && !view.risks.has(fundRisk(row) ?? -1)) return false
		if (view.family !== null && fundFamily(row) !== view.family) return false
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
