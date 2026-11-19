import { SOURCE_IDS, type SourceId } from "@fundstats/shared/sources"

import { getTable } from "./tables.ts"

/**
 * The viewer's own settings: how the table looks and what the app shows. They live in a cookie, not in
 * the URL (a shared link shows the data, not the sender's taste) and not in localStorage (the server
 * reads the cookie, so the first paint already has them).
 */
export interface Prefs {
	readonly density: "comfy" | "compact"
	readonly sparklines: boolean
	/** Edge to edge, or a floating panel inset from the window. */
	readonly layout: "edge" | "floating"
	/** Whether features without a backend yet (marked SOON) are listed. */
	readonly showSoon: boolean
	/** Optional columns the viewer turned on or off, per source; the rest follow the column defaults. */
	readonly columns: Partial<Record<SourceId, Readonly<Record<string, boolean>>>>
}

export const DEFAULT_PREFS: Prefs = {
	density: "comfy",
	sparklines: true,
	layout: "edge",
	showSoon: true,
	columns: {},
}

export const PREFS_COOKIE = "fundstats-prefs"

const oneOf = <A extends string>(value: unknown, options: ReadonlyArray<A>, fallback: A): A =>
	options.includes(value as A) ? (value as A) : fallback

/** Settings from the cookie's value; anything unknown or malformed takes its default. */
export const parsePrefs = (raw: string | undefined): Prefs => {
	let data: Record<string, unknown> = {}
	try {
		const parsed: unknown = raw ? JSON.parse(decodeURIComponent(raw)) : {}
		if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>
	} catch {
		// A cookie from another version, or edited by hand: start from the defaults.
	}
	const columns: Partial<Record<SourceId, Record<string, boolean>>> = {}
	const rawColumns = data.columns && typeof data.columns === "object" ? (data.columns as Record<string, unknown>) : {}
	for (const source of SOURCE_IDS) {
		const entry = rawColumns[source]
		if (!entry || typeof entry !== "object") continue
		const optional = new Set(
			getTable(source)
				.columns.filter((c) => !c.required)
				.map((c) => c.id),
		)
		const kept = Object.entries(entry).filter(([id, on]) => optional.has(id) && typeof on === "boolean")
		if (kept.length > 0) columns[source] = Object.fromEntries(kept)
	}
	return {
		density: oneOf(data.density, ["comfy", "compact"], DEFAULT_PREFS.density),
		sparklines: typeof data.sparklines === "boolean" ? data.sparklines : DEFAULT_PREFS.sparklines,
		layout: oneOf(data.layout, ["edge", "floating"], DEFAULT_PREFS.layout),
		showSoon: typeof data.showSoon === "boolean" ? data.showSoon : DEFAULT_PREFS.showSoon,
		columns,
	}
}

const serializePrefs = (prefs: Prefs) => encodeURIComponent(JSON.stringify(prefs))

/** Whether an optional column is shown: the viewer's choice, else the column's default. */
export const isColumnVisible = (prefs: Prefs, source: SourceId, columnId: string) => {
	const column = getTable(source).columns.find((c) => c.id === columnId)
	if (!column) return false
	if (column.required) return true
	return prefs.columns[source]?.[columnId] ?? !column.hidden
}

export const withColumn = (prefs: Prefs, source: SourceId, columnId: string, on: boolean): Prefs => ({
	...prefs,
	columns: { ...prefs.columns, [source]: { ...prefs.columns[source], [columnId]: on } },
})

/** The cookie as the browser sends it, for a year, to this site's pages only. */
export const prefsCookie = (prefs: Prefs) =>
	`${PREFS_COOKIE}=${serializePrefs(prefs)}; Path=/; Max-Age=31536000; SameSite=Lax`

/** The cookie's value in a `Cookie` header or `document.cookie`. */
export const readPrefsCookie = (header: string) =>
	header
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${PREFS_COOKIE}=`))
		?.slice(PREFS_COOKIE.length + 1)
