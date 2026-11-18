import { isSourceId, KIND_SEGMENT, SOURCES, type SourceId } from "@fundstats/shared/sources"
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router"

import { latestQuery } from "#/web/api.ts"
import { validateTableSearch } from "#/web/search.ts"

/**
 * One source: /funds/mbank, /crypto/coingecko. Its table and its instruments' detail pages share
 * the table's search params, so a detail page's back link returns to the same view.
 */
export const Route = createFileRoute("/$kind/$source")({
	validateSearch: validateTableSearch,
	params: {
		parse: (raw) => {
			const source = raw.source
			if (!isSourceId(source) || KIND_SEGMENT[SOURCES[source].kind] !== raw.kind) throw notFound()
			return { kind: raw.kind, source: source as SourceId }
		},
		stringify: (params) => params,
	},
	loader: ({ context, params }) => context.queryClient.ensureQueryData(latestQuery(params.source)),
	component: Outlet,
})
