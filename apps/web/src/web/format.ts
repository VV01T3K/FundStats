import * as DateTime from "effect/DateTime"

// Fixed locale and time zone so server-rendered and hydrated text match.
const LOCALE = "pl-PL"
const TIME_ZONE = "Europe/Warsaw"

const NARROW_NBSP = " "
const MINUS = "−"

/** pl-PL groups with a no-break space; use the narrow one and a real minus sign. */
const typeset = (text: string) => text.replaceAll(" ", NARROW_NBSP).replaceAll("-", MINUS)

const percentFormat = new Intl.NumberFormat(LOCALE, {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
	signDisplay: "exceptZero",
	useGrouping: "always",
})
const fixed2 = new Intl.NumberFormat(LOCALE, {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
	useGrouping: "always",
})
const small = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 6, useGrouping: "always" })
const compact = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumSignificantDigits: 3 })
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: "always" })

const twoDecimals = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
	roundingMode: "halfExpand",
	useGrouping: false,
})

/**
 * The value at two decimals, halves away from zero on its shortest decimal form (2.675 → 2.68, where
 * `toFixed` sees the binary 2.67499…): the one rounding rule behind both the printed percent and its
 * heat step, so a cell reading `0,00%` is never washed and `−0,01%` always is.
 */
export const roundForDisplay = (value: number) => Number(twoDecimals.format(value))

/** `+4,12%`, `−0,73%`, `0,00%`. */
export const formatPercent = (value: number) => `${typeset(percentFormat.format(roundForDisplay(value)))}%`

/** Two decimals from 1 up (including what rounds up to 1), up to six significant digits below. */
export const formatPrice = (value: number) =>
	typeset(Math.abs(Number(value.toPrecision(6))) >= 1 ? fixed2.format(value) : small.format(value))

/** `1,3 bln`, `221 mld`, `64,5 mln` (Polish short scale words). */
export const formatCompact = (value: number) => typeset(compact.format(value))

const fixedFormats = new Map<number, Intl.NumberFormat>()

/** A fixed number of decimals, for axis ticks. */
export const formatFixed = (value: number, decimals: number) => {
	let format = fixedFormats.get(decimals)
	if (!format) {
		format = new Intl.NumberFormat(LOCALE, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
			useGrouping: "always",
		})
		fixedFormats.set(decimals, format)
	}
	return typeset(format.format(value))
}

export const formatInteger = (value: number) => typeset(integer.format(value))

/** `2026-11-17` → `17.11.2026`. Valuation dates are calendar dates; no time zone applies. */
export const formatDate = (isoDate: string) => {
	const [year, month, day] = isoDate.slice(0, 10).split("-")
	return `${day}.${month}.${year}`
}

const dayMonthTime = new Intl.DateTimeFormat(LOCALE, {
	timeZone: TIME_ZONE,
	day: "2-digit",
	month: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
})
const fullDateTime = new Intl.DateTimeFormat(LOCALE, {
	timeZone: TIME_ZONE,
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
})
const warsawDate = new Intl.DateTimeFormat(LOCALE, {
	timeZone: TIME_ZONE,
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
})

const formatParts = (format: Intl.DateTimeFormat, iso: string) => {
	const parts = DateTime.formatIntl(DateTime.makeUnsafe(iso), format)
	return parts.replace(/,\s*/, ", ")
}

/** A chart time as ISO, for the timestamp formatters below. */
export const epochToIso = (t: number) => DateTime.formatIso(DateTime.makeUnsafe(t))

/** A valuation date stored as UTC midnight, as `17.11.2026`. */
export const formatEpochDay = (t: number) => formatDate(DateTime.formatIsoDateUtc(DateTime.makeUnsafe(t)))

/** `18.11, 06:02` in Warsaw time. */
export const formatCaptured = (iso: string) => formatParts(dayMonthTime, iso)

/** `18.11.2026, 06:02` in Warsaw time. */
export const formatCapturedFull = (iso: string) => formatParts(fullDateTime, iso)

/** `18.11.2026`, the Warsaw calendar day of a timestamp. */
export const formatCapturedDate = (iso: string) => DateTime.formatIntl(DateTime.makeUnsafe(iso), warsawDate)

const plural = new Intl.PluralRules(LOCALE)

/** Polish noun forms: one (1), few (2–4, 22–24…), many (5–21, 25…). */
export interface NounForms {
	readonly one: string
	readonly few: string
	readonly many: string
}

export const countNoun = (count: number, forms: NounForms) => {
	const rule = plural.select(count)
	return rule === "one" ? forms.one : rule === "few" ? forms.few : forms.many
}
