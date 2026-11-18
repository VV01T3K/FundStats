/**
 * Plain `key=value` search params (the router's default JSON-encodes values, turning `?risk=3`
 * into a number and `?pin=a,b` into `%5B…`); routes validate every value as a string.
 */
export const parseSearch = (search: string): Record<string, unknown> =>
	Object.fromEntries(new URLSearchParams(search.startsWith("?") ? search.slice(1) : search))

export const stringifySearch = (search: Record<string, unknown>) => {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(search)) {
		if (value !== undefined && value !== null && value !== "") params.set(key, String(value))
	}
	const text = params.toString().replaceAll("%2C", ",")
	return text.length > 0 ? `?${text}` : ""
}
