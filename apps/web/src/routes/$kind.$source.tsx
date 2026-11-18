import { isSourceId, KIND_SEGMENT, SOURCES, type SourceId } from "@fundstats/shared/sources"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router"
import { useRef, useState } from "react"

import { latestQuery, sourcesQuery, sparklinesQuery } from "#/web/api.ts"
import { AppHeader } from "#/web/components/AppHeader.tsx"
import { Footer } from "#/web/components/Footer.tsx"
import { MobileTabBar } from "#/web/components/MobileTabBar.tsx"
import { SearchField, useSlashToSearch } from "#/web/components/SearchField.tsx"
import { Sidebar } from "#/web/components/Sidebar.tsx"
import { SourceTabs } from "#/web/components/SourceTabs.tsx"
import { TipProvider } from "#/web/components/Tip.tsx"
import { refreshInterval } from "#/web/prefs.ts"
import { usePrefs } from "#/web/PrefsContext.tsx"
import { resolveView, type TableSearch, thresholdPatch, validateTableSearch } from "#/web/search.ts"
import { getTable } from "#/web/tables.ts"

/**
 * One source: /funds/mbank, /crypto/coingecko. The terminal's frame (header, source tabs, footer,
 * menu) around its table and its instruments' detail pages, which share the table's search params so
 * a detail page's back link returns to the same view.
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
	loader: async ({ context, params }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(latestQuery(params.source)),
			context.queryClient.ensureQueryData(sourcesQuery()),
			context.queryClient.ensureQueryData(sparklinesQuery(params.source)),
		])
	},
	head: ({ params }) => ({ meta: [{ title: `${getTable(params.source).title} · FundStats` }] }),
	component: SourceLayout,
})

function SourceLayout() {
	const { source } = Route.useParams()
	const search = Route.useSearch()
	const navigate = Route.useNavigate()
	const { prefs } = usePrefs()
	const interval = refreshInterval(prefs.refresh)
	const { data } = useSuspenseQuery({ ...latestQuery(source), refetchInterval: interval })
	const statuses = useQuery({ ...sourcesQuery(), refetchInterval: interval }).data ?? [data.source]
	const config = getTable(source)
	const view = resolveView(config, search)
	const menu = useRef<HTMLDialogElement>(null)
	const [menuOpen, setMenuOpen] = useState(false)
	useSlashToSearch()

	const update = (patch: Partial<TableSearch>) =>
		navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })
	// Searching from an instrument's page goes back to the table it filters.
	const onQuery = (q: string) =>
		navigate({
			to: "/$kind/$source",
			params: (prev) => prev,
			search: (prev) => ({ ...prev, q: q || undefined }),
			replace: true,
			resetScroll: false,
		})

	return (
		<TipProvider>
			<div className="bg-bg flex h-dvh flex-col overflow-hidden">
				<AppHeader
					status={data.source}
					query={view.q}
					onQuery={onQuery}
					menuExpanded={menuOpen}
					onMenu={() => {
						menu.current?.showModal()
						setMenuOpen(true)
					}}
				/>
				<SourceTabs source={source} statuses={statuses} />
				<div className="border-rule shrink-0 border-b px-3 py-2 lg:hidden">
					<SearchField query={view.q} onQuery={onQuery} />
				</div>
				<main className="flex min-h-0 flex-1 flex-col [view-transition-name:source-panel]">
					<Outlet />
				</main>
				<Footer />
				<MobileTabBar />
			</div>
			<Sidebar
				dialog={menu}
				source={source}
				statuses={statuses}
				threshold={view.threshold}
				onThreshold={(threshold) => update(thresholdPatch(config, threshold))}
				onClose={() => setMenuOpen(false)}
			/>
		</TipProvider>
	)
}
