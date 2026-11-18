import type { SnapshotRow } from "@fundstats/shared/api"

import { roundForDisplay } from "./format.ts"
import { type Column, columnOf, FUND_CATEGORIES, longName, type TableConfig, THRESHOLD_MAX } from "./tables.ts"

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
	return out
}

export interface ResolvedView {
	readonly sort: string
	readonly desc: boolean
	readonly q: string
	/** null = every category; always null for crypto. */
	readonly category: string | null
	readonly threshold: number
	/** The percent column the threshold reads: the sorted one, or the source's default. */
	readonly highlight: Column
}

const ALL = "all"

/** Applies the source's defaults to whatever the URL holds. */
export const resolveView = (config: TableConfig, search: TableSearch): ResolvedView => {
	const wanted = search.sort === undefined ? undefined : columnOf(config, search.sort)
	const sortColumn = wanted?.sortValue ? wanted : columnOf(config, config.defaultSort)!
	const dir = wanted?.sortValue && search.dir ? search.dir : sortColumn.firstDir
	const known = FUND_CATEGORIES.some((c) => c.value === search.category)
	return {
		sort: sortColumn.id,
		desc: dir === "desc",
		q: search.q ?? "",
		category:
			config.kind !== "fund" || search.category === ALL ? null : known ? search.category! : FUND_CATEGORIES[0].value,
		threshold: search.threshold ?? config.defaultThreshold,
		highlight: sortColumn.kind === "percent" ? sortColumn : columnOf(config, config.defaultSort)!,
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

/** Lower-case, without Polish diacritics, so "zrownowazony" finds "Zrównoważony". */
const fold = (value: string) =>
	value
		.toLocaleLowerCase("pl-PL")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replaceAll("ł", "l")

/** Rows in the selected category whose name, ticker or long name contain every search word. */
export const filterRows = (rows: ReadonlyArray<SnapshotRow>, view: ResolvedView) => {
	const terms = fold(view.q).split(/\s+/).filter(Boolean)
	return rows.filter((row) => {
		if (view.category !== null && row.category !== view.category) return false
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
