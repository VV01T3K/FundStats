import * as DateTime from "effect/DateTime"

// Fixed locale and time zone so server-rendered and hydrated text match.
const LOCALE = "pl-PL"
const TIME_ZONE = "Europe/Warsaw"

/** pl-PL groups digits with a no-break space (U+00A0), which keeps a figure on one line; minus is U+2212. */
const typeset = (text: string) => text.replaceAll("-", "\u2212")

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
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: "always" })

const twoDecimals = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
	roundingMode: "halfExpand",
	useGrouping: false,
})

/**
 * The value at two decimals, halves away from zero on its shortest decimal form (2.675 → 2.68, where
 * `toFixed` sees the binary 2.67499…): the one rounding rule behind the printed percent, its colour
 * and the threshold highlight, so `0,00%` is never green and `+40,00%` never misses a 40% threshold.
 */
export const roundForDisplay = (value: number) => Number(twoDecimals.format(value))

/** `+9,15%`, `−4,51%`, `0,00%`. */
export const formatPercent = (value: number) => `${typeset(percentFormat.format(roundForDisplay(value)))}%`

/** Gain, loss or flat, by the value as printed. */
export const trend = (value: number): "up" | "down" | "flat" => {
	const shown = roundForDisplay(value)
	return shown > 0 ? "up" : shown < 0 ? "down" : "flat"
}

/** `412 840,32`: two decimals from 1 up (including what rounds up to 1), six significant digits below. */
export const formatPrice = (value: number) =>
	typeset(Math.abs(Number(value.toPrecision(6))) >= 1 ? fixed2.format(value) : small.format(value))

const SCALES = [
	[1e12, "T"],
	[1e9, "B"],
	[1e6, "M"],
	[1e3, "K"],
] as const

/** `384,00B`, `8,14T`: pl-PL digits with the short-scale letters the terminal uses. */
export const formatCompact = (value: number) => {
	const scale = SCALES.find(([size]) => Math.abs(value) >= size)
	return scale ? `${typeset(fixed2.format(value / scale[0]))}${scale[1]}` : typeset(integer.format(value))
}

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

const warsaw = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options })
const dayMonthTime = warsaw({ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
const fullDate = warsaw({ day: "2-digit", month: "2-digit", year: "numeric" })
const clock = warsaw({ hour: "2-digit", minute: "2-digit" })
// pl-PL names the zone "CET" too, but en-GB is the locale that reliably gives the CET/CEST abbreviation.
const zoneName = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, timeZoneName: "short" })

const at = (iso: string) => DateTime.makeUnsafe(iso)

/** `CET` or `CEST`, Warsaw's zone at that moment. */
const zoneOf = (iso: string) =>
	zoneName.formatToParts(DateTime.toDateUtc(at(iso))).find((part) => part.type === "timeZoneName")?.value ?? ""

/** `18.11, 06:02` in Warsaw time. */
export const formatCaptured = (iso: string) => DateTime.formatIntl(at(iso), dayMonthTime).replace(/,\s*/, ", ")

/** `18.11.2026 · 06:02 CET`, the header clock. */
export const formatStamp = (iso: string) =>
	`${DateTime.formatIntl(at(iso), fullDate)} · ${DateTime.formatIntl(at(iso), clock)} ${zoneOf(iso)}`.trim()

/** `18.11.2026`, the Warsaw calendar day of a timestamp. */
export const formatCapturedDate = (iso: string) => DateTime.formatIntl(at(iso), fullDate)

/** A chart time as ISO, for the timestamp formatters above. */
export const epochToIso = (t: number) => DateTime.formatIso(DateTime.makeUnsafe(t))

/** A valuation date stored as UTC midnight, as `17.11.2026`. */
export const formatEpochDay = (t: number) => formatDate(DateTime.formatIsoDateUtc(DateTime.makeUnsafe(t)))

/** `6h`, `30m`, `1d`: a collection interval. */
export const formatInterval = (seconds: number) =>
	seconds % 86_400 === 0
		? `${seconds / 86_400}d`
		: seconds % 3600 === 0
			? `${seconds / 3600}h`
			: `${Math.round(seconds / 60)}m`
