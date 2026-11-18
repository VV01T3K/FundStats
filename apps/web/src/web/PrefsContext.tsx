import { createIsomorphicFn } from "@tanstack/react-start"
import { createContext, type ReactNode, useContext, useState } from "react"

import { DEFAULT_PREFS, parsePrefs, type Prefs, prefsCookie, PREFS_COOKIE, readPrefsCookie } from "./prefs.ts"

/** The viewer's settings from the request's cookie on the server, from `document.cookie` in the browser. */
export const loadPrefs = createIsomorphicFn()
	.server(async () => {
		const { getCookie } = await import("@tanstack/react-start/server")
		return parsePrefs(getCookie(PREFS_COOKIE))
	})
	.client(async () => parsePrefs(readPrefsCookie(document.cookie)))

const PrefsContext = createContext<{ readonly prefs: Prefs; readonly update: (next: Prefs) => void }>({
	prefs: DEFAULT_PREFS,
	update: () => {},
})

export function PrefsProvider({ initial, children }: { readonly initial: Prefs; readonly children: ReactNode }) {
	const [prefs, setPrefs] = useState(initial)
	const update = (next: Prefs) => {
		setPrefs(next)
		// A cookie rather than storage: the server reads it to render the first paint with these settings.
		document.cookie = prefsCookie(next)
	}
	return <PrefsContext value={{ prefs, update }}>{children}</PrefsContext>
}

export const usePrefs = () => useContext(PrefsContext)
