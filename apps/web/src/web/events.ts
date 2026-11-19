import { isSourceId } from "@fundstats/shared/sources"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

/**
 * Keeps open pages current without polling: the server streams an event each time the collector
 * stores a run (/api/v1/events), and this marks that source's queries stale, so the ones on screen
 * refetch. EventSource reconnects by itself after a dropped connection; a page that was offline
 * meanwhile catches up when its queries refetch on focus.
 */
export function useDataEvents() {
	const queryClient = useQueryClient()
	useEffect(() => {
		const events = new EventSource("/api/v1/events")
		events.addEventListener("message", (event: MessageEvent<string>) => {
			const { source } = JSON.parse(event.data) as { source?: unknown }
			if (typeof source !== "string" || !isSourceId(source)) return
			// Every key that holds a source's data starts with its kind, then the source id.
			void queryClient.invalidateQueries({
				predicate: (query) => query.queryKey[0] === "sources" || query.queryKey[1] === source,
			})
		})
		return () => events.close()
	}, [queryClient])
}
