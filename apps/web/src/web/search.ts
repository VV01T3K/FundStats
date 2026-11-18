import type { SnapshotRow } from "@fundstats/shared/api"

import {
	type Column,
	FUND_CATEGORIES,
	fundFamily,
	fundRisk,
	longName,
	NAME_COLUMN,
	type Preset,
	rankColumn,
	type TableConfig,
} from "./tables.ts"

/**
 * URL search params of a table view, shared by its detail pages so "back" restores the table.
 * Validation is lenient: unknown or invalid values are dropped and the view falls back to the
 * source defaults, so a hand-edited link still opens the table. Lists are comma-separated.
 */
export interface TableSearch {
	/** Setting a param to undefined removes it from the URL. */
	readonly q?: string | undefined
	readonly preset?: string | undefined
	readonly sort?: string | undefined
	readonly dir?: "asc" | "desc" | undefined
	readonly category?: string | undefined
	readonly risk?: string | undefined
	readonly family?: string | undefined
	readonly pin?: string | undefined
}

export const MAX_PINS = 4

const text = (value: unknown, max: number) => {
	const raw = typeof value === "number" ? String(value) : value
	if (typeof raw !== "string") return undefined
	const trimmed = raw.trim()
	return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined
}

const splitList = (value: string | undefined) =>
	value === undefined ? [] : value.split(",").filter((item) => item.length > 0)

const joinList = (items: ReadonlyArray<string | number>) => (items.length > 0 ? items.join(",") : undefined)

const normalizeRisk = (value: string | undefined) => {
	const levels = new Set(
		splitList(value)
			.map(Number)
			.filter((level) => Number.isInteger(level) && level >= 1 && level <= 7),
	)
	return joinList([...levels].sort((a, b) => a - b))
}

/** Ids are resolved against the source's rows (and capped) in `resolvePins`; here only bounded. */
const normalizePins = (value: string | undefined) =>
	joinList([...new Set(splitList(value).filter((id) => id.length <= 64))].slice(0, 16))

export const validateTableSearch = (raw: Record<string, unknown>): TableSearch => {
	const out: { -readonly [K in keyof TableSearch]: TableSearch[K] } = {}
	const q = text(raw.q, 100)
	if (q) out.q = q
	const preset = text(raw.preset, 32)
	if (preset) out.preset = preset
	const sort = text(raw.sort, 32)
	if (sort) out.sort = sort
	if (raw.dir === "asc" || raw.dir === "desc") out.dir = raw.dir
	const category = text(raw.category, 64)
	if (category) out.category = category
	const risk = normalizeRisk(text(raw.risk, 32))
	if (risk) out.risk = risk
	const family = text(raw.family, 160)
	if (family) out.family = family
	const pin = normalizePins(text(raw.pin, 400))
	if (pin) out.pin = pin
	return out
}

export interface ResolvedView {
	readonly preset: Preset
	/** Numeric columns in display order (the rank column of crypto tables comes first). */
	readonly columns: ReadonlyArray<Column>
	readonly sort: string
	readonly desc: boolean
	readonly q: string
	/** null = every category. */
	readonly category: string | null
	readonly risk: ReadonlySet<number>
	readonly family: string | null
	readonly pins: ReadonlyArray<string>
}

const presetOf = (config: TableConfig, id: string | undefined) =>
	config.presets.find((p) => p.id === id) ?? config.presets.find((p) => p.id === config.defaultPreset)!

const visibleColumns = (config: TableConfig, preset: Preset): ReadonlyArray<Column> => [
	...(config.kind === "crypto" ? [rankColumn] : []),
	...config.periods.filter((c) => preset.columns.includes(c.id)),
	...config.fixed,
]

/** Pinned ids that name a row of this source, first four; stale or foreign ids take no slot. */
export const resolvePins = (pin: string | undefined, rows: ReadonlyArray<SnapshotRow>) => {
	const known = new Set(rows.map((row) => row.externalId))
	return splitList(pin)
		.filter((id) => known.has(id))
		.slice(0, MAX_PINS)
}

/** Families present in the data, with their row counts. */
export const familiesOf = (rows: ReadonlyArray<SnapshotRow>) => {
	const counts = new Map<string, number>()
	for (const row of rows) {
		const family = fundFamily(row)
		if (family) counts.set(family, (counts.get(family) ?? 0) + 1)
	}
	return counts
}

/** Applies the source's defaults to whatever the URL holds. */
export const resolveView = (
	config: TableConfig,
	search: TableSearch,
	rows: ReadonlyArray<SnapshotRow>,
): ResolvedView => {
	const preset = presetOf(config, search.preset)
	const columns = visibleColumns(config, preset)
	const sortable = new Map<string, "asc" | "desc">([
		[NAME_COLUMN, "asc"],
		...columns.map((c): [string, "asc" | "desc"] => [c.id, c.firstDir]),
	])
	const explicitSort = search.sort !== undefined && sortable.has(search.sort)
	const sort = explicitSort ? search.sort! : preset.sort
	const dir = explicitSort && search.dir ? search.dir : sortable.get(sort)
	const isFund = config.kind === "fund"
	return {
		preset,
		columns,
		sort,
		desc: dir === "desc",
		q: search.q ?? "",
		category:
			isFund && search.category && FUND_CATEGORIES.some((c) => c.value === search.category) ? search.category : null,
		risk: new Set(isFund ? splitList(search.risk).map(Number) : []),
		family: isFund && search.family && familiesOf(rows).has(search.family) ? search.family : null,
		pins: resolvePins(search.pin, rows),
	}
}

const firstDirOf = (columns: ReadonlyArray<Column>, id: string) => columns.find((c) => c.id === id)?.firstDir ?? "asc"

/** Sort params for `sort`/`desc` under `preset`, omitted when they are that preset's default. */
const sortParams = (preset: Preset, columns: ReadonlyArray<Column>, sort: string, desc: boolean) => {
	const dir = desc ? ("desc" as const) : ("asc" as const)
	return sort === preset.sort && dir === firstDirOf(columns, sort) ? { sort: undefined, dir: undefined } : { sort, dir }
}

/** The search change for picking a preset: filters stay; the sort stays only while its column is shown. */
export const presetPatch = (config: TableConfig, view: ResolvedView, presetId: string): Partial<TableSearch> => {
	const next = presetOf(config, presetId)
	const columns = visibleColumns(config, next)
	const keepsSort = view.sort === NAME_COLUMN || columns.some((c) => c.id === view.sort)
	return {
		preset: next.id === config.defaultPreset ? undefined : next.id,
		...(keepsSort ? sortParams(next, columns, view.sort, view.desc) : { sort: undefined, dir: undefined }),
	}
}

/** The search change for sorting by `columnId`: a new column starts in its natural direction. */
export const sortPatch = (view: ResolvedView, columnId: string): Partial<TableSearch> => {
	const desc = view.sort === columnId ? !view.desc : firstDirOf(view.columns, columnId) === "desc"
	return sortParams(view.preset, view.columns, columnId, desc)
}

export const togglePin = (pins: ReadonlyArray<string>, id: string): string | undefined =>
	pins.includes(id)
		? joinList(pins.filter((p) => p !== id))
		: pins.length >= MAX_PINS
			? joinList(pins)
			: joinList([...pins, id])

export const toggleRisk = (risk: ReadonlySet<number>, level: number) =>
	joinList((risk.has(level) ? [...risk].filter((r) => r !== level) : [...risk, level]).sort((a, b) => a - b))

/** Lower-case, without Polish diacritics, so "zrownowazony" finds "Zrównoważony". */
export const fold = (value: string) =>
	value
		.toLocaleLowerCase("pl-PL")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replaceAll("ł", "l")

type Facet = "category" | "risk" | "family"

/** Rows passing every filter except `skip`, for the counts next to that filter's options. */
export const filterRows = (rows: ReadonlyArray<SnapshotRow>, view: ResolvedView, skip?: Facet) => {
	const terms = fold(view.q).split(/\s+/).filter(Boolean)
	return rows.filter((row) => {
		if (skip !== "category" && view.category !== null && row.category !== view.category) return false
		if (skip !== "risk" && view.risk.size > 0) {
			const risk = fundRisk(row)
			if (risk === null || !view.risk.has(risk)) return false
		}
		if (skip !== "family" && view.family !== null && fundFamily(row) !== view.family) return false
		if (terms.length > 0) {
			const haystack = fold([row.name, row.symbol ?? "", longName(row) ?? ""].join(" "))
			if (!terms.every((term) => haystack.includes(term))) return false
		}
		return true
	})
}

export const hasFilters = (view: ResolvedView) =>
	view.q.length > 0 || view.category !== null || view.risk.size > 0 || view.family !== null

export const CLEAR_FILTERS: Partial<TableSearch> = {
	q: undefined,
	category: undefined,
	risk: undefined,
	family: undefined,
}
