/**
 * Plain `key=value` search params. The router's default JSON-encodes values (`?q=%22btc%22`), which
 * makes hand-edited links fragile; routes validate every value from its string form.
 */
export const parseSearch = (search: string): Record<string, unknown> =>
	Object.fromEntries(new URLSearchParams(search.startsWith("?") ? search.slice(1) : search))

export const stringifySearch = (search: Record<string, unknown>) => {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(search)) {
		if (value !== undefined && value !== null && value !== "") params.set(key, String(value))
	}
	const text = params.toString()
	return text.length > 0 ? `?${text}` : ""
}
