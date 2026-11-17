import * as DateTime from "effect/DateTime"

// Fixed locale and time zone so server-rendered and hydrated text match.
const dateTime = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Warsaw",
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
})

export const formatDateTime = (iso: string) => `${DateTime.formatIntl(DateTime.makeUnsafe(iso), dateTime)} (Warsaw)`

const fixed2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const priceFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 })

export const formatPercent = (value: number) => `${value > 0 ? "+" : ""}${fixed2.format(value)} %`
export const formatNumber = (value: number) => fixed2.format(value)
export const formatPrice = (value: number) => (Math.abs(value) >= 1 ? fixed2.format(value) : priceFormat.format(value))

/** Tailwind class for a gain (green), loss (red) or flat value. */
export const trendClass = (value: number | null) =>
	value === null || value === 0 ? "text-muted-foreground" : value > 0 ? "text-gain" : "text-loss"
