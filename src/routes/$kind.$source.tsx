import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { useMemo } from "react"
import { Button } from "#/components/ui/button"
import { isSourceId, KIND_SEGMENT, SOURCES, type SourceId } from "#/shared/sources.ts"
import { latestQuery } from "#/web/api.ts"
import { DataTable } from "#/web/components/DataTable.tsx"
import { SourceStatusBar } from "#/web/components/SourceStatusBar.tsx"
import { resolveView, type TableSearch, validateTableSearch } from "#/web/search.ts"
import { getTable } from "#/web/tables/index.ts"

/** One table view per source: /funds/mbank, /crypto/coingecko, ... */
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
	head: ({ params }) => ({ meta: [{ title: `${SOURCES[params.source].name} · FundStats` }] }),
	component: SourceTablePage,
})

function SourceTablePage() {
	const { source } = Route.useParams()
	const search = Route.useSearch()
	const navigate = Route.useNavigate()
	const { data } = useSuspenseQuery(latestQuery(source))
	const config = getTable(source)
	const view = resolveView(config, search)

	const rows = useMemo(
		() =>
			view.category && view.category !== "all" ? data.rows.filter((row) => row.category === view.category) : data.rows,
		[data.rows, view.category],
	)

	const update = (patch: Partial<TableSearch>) =>
		navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">{SOURCES[source].name}</h1>
				<span className="text-sm text-muted-foreground">{rows.length} rows</span>
			</div>

			<SourceStatusBar status={data.source} rows={data.rows} />

			{config.categories ? (
				<FilterGroup label="Category">
					{[...config.categories, { value: "all", label: "Wszystkie" }].map((c) => (
						<Choice key={c.value} active={view.category === c.value} onClick={() => update({ category: c.value })}>
							{c.label}
						</Choice>
					))}
				</FilterGroup>
			) : null}

			{config.periods ? (
				<FilterGroup label="Period">
					{config.periods.map((p) => (
						<Choice
							key={p}
							active={view.period === p}
							// Choosing a period also sorts by it, as the old tables did.
							onClick={() => update({ period: p, sort: undefined, dir: undefined })}
						>
							{p}
						</Choice>
					))}
				</FilterGroup>
			) : null}

			{config.thresholds ? (
				<FilterGroup label={`Highlight above (${view.period})`}>
					{[0, ...config.thresholds].map((t) => (
						<Choice key={t} active={view.threshold === t} onClick={() => update({ threshold: t })}>
							{t === 0 ? "Off" : `${t} %`}
						</Choice>
					))}
				</FilterGroup>
			) : null}

			<div className="rounded-lg border">
				<DataTable
					config={config}
					rows={rows}
					view={view}
					onSortChange={(sort, desc) => update({ sort, dir: desc ? "desc" : "asc" })}
				/>
			</div>

			<div className="text-center">
				<a href="#top" className="text-sm text-muted-foreground underline underline-offset-4">
					Back to top
				</a>
			</div>
		</section>
	)
}

function FilterGroup({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="w-full text-xs uppercase tracking-wide text-muted-foreground sm:w-auto sm:min-w-24">
				{label}
			</span>
			{children}
		</div>
	)
}

function Choice({
	active,
	onClick,
	children,
}: {
	readonly active: boolean
	readonly onClick: () => void
	readonly children: React.ReactNode
}) {
	return (
		<Button size="sm" variant={active ? "default" : "secondary"} aria-pressed={active} onClick={onClick}>
			{children}
		</Button>
	)
}
