import type { TableConfig } from "./tables/types.ts"

/**
 * URL search params of a table view. Validation is lenient: unknown or
 * invalid values are dropped and the view falls back to the source defaults,
 * so a hand-edited link still opens the table.
 */
export interface TableSearch {
	/** Setting a param to undefined removes it from the URL. */
	readonly sort?: string | undefined
	readonly dir?: "asc" | "desc" | undefined
	readonly category?: string | undefined
	readonly period?: string | undefined
	readonly threshold?: number | undefined
}

const text = (value: unknown) =>
	typeof value === "string" && value.length > 0 && value.length < 64 ? value : undefined

export const validateTableSearch = (raw: Record<string, unknown>): TableSearch => {
	const threshold = typeof raw.threshold === "number" ? raw.threshold : Number(text(raw.threshold))
	const out: { -readonly [K in keyof TableSearch]: TableSearch[K] } = {}
	const sort = text(raw.sort)
	if (sort) out.sort = sort
	if (raw.dir === "asc" || raw.dir === "desc") out.dir = raw.dir
	const category = text(raw.category)
	if (category) out.category = category
	const period = text(raw.period)
	if (period) out.period = period
	if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 10_000) out.threshold = threshold
	return out
}

export const NAME_COLUMN = "name"

export interface ResolvedView {
	readonly sort: string
	readonly desc: boolean
	readonly category: string | null
	readonly period: string | null
	/** Rows whose period change is above this are highlighted; 0 = off. */
	readonly threshold: number
}

/** Applies the source's defaults to whatever the URL holds. */
export const resolveView = (config: TableConfig, search: TableSearch): ResolvedView => {
	const columnIds = new Set([NAME_COLUMN, ...config.columns.map((c) => c.id)])
	const period =
		config.periods && search.period && config.periods.includes(search.period)
			? search.period
			: (config.defaultPeriod ?? null)
	const sort = search.sort && columnIds.has(search.sort) ? search.sort : (period ?? config.defaultSort)
	const categories = config.categories?.map((c) => c.value) ?? []
	const category = config.categories
		? search.category === "all" || (search.category && categories.includes(search.category))
			? search.category
			: (config.defaultCategory ?? "all")
		: null
	return {
		sort,
		desc: search.dir ? search.dir === "desc" : sort !== NAME_COLUMN,
		category,
		period,
		threshold: config.thresholds ? (search.threshold ?? config.defaultThreshold ?? 0) : 0,
	}
}
