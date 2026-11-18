import { SOURCES, type SourceId } from "@fundstats/shared/sources"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Pin, X } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { cn } from "#/lib/utils"
import { latestQuery } from "#/web/api.ts"
import { Segmented, StatusDot, TextButton } from "#/web/components/controls.tsx"
import { FilterRow, FiltersSheet, SearchBox, SortMenu } from "#/web/components/Filters.tsx"
import { Footer } from "#/web/components/Footer.tsx"
import { Sheet } from "#/web/components/Sheet.tsx"
import { SheetScroller } from "#/web/components/SheetScroller.tsx"
import { countNoun } from "#/web/format.ts"
import { freshness, tableAsOf } from "#/web/freshness.ts"
import { riskScale } from "#/web/risk.ts"
import {
	CLEAR_FILTERS,
	filterRows,
	hasFilters,
	presetPatch,
	resolveView,
	sortPatch,
	type TableSearch,
	togglePin,
} from "#/web/search.ts"
import { getTable } from "#/web/tables.ts"

export const Route = createFileRoute("/$kind/$source/")({
	head: ({ params }) => ({ meta: [{ title: `${getTable(params.source).title} · FundStats` }] }),
	component: SourceTablePage,
})

const isTyping = (target: EventTarget | null) =>
	target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))

function SourceTablePage() {
	const { kind, source } = Route.useParams()
	const search = Route.useSearch()
	const navigate = Route.useNavigate()
	const { data } = useSuspenseQuery(latestQuery(source))
	const config = getTable(source)
	const view = useMemo(() => resolveView(config, search, data.rows), [config, search, data.rows])
	const rows = useMemo(() => filterRows(data.rows, view), [data.rows, view])
	const asOf = useMemo(() => tableAsOf(data.rows), [data.rows])
	const risk = useMemo(() => riskScale(data.rows), [data.rows])
	const fresh = freshness(data.source, asOf)
	const otherDates = asOf ? data.rows.filter((row) => row.asOf !== null && row.asOf !== asOf).length : 0
	const searchRef = useRef<HTMLInputElement>(null)

	const update = (patch: Partial<TableSearch>) =>
		navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })
	const open = (externalId: string) =>
		navigate({ to: "/$kind/$source/$externalId", params: { kind, source, externalId }, search: (prev) => prev })
	const pin = (externalId: string) => update({ pin: togglePin(view.pins, externalId) })

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
			if (event.key === "/") {
				event.preventDefault()
				searchRef.current?.focus()
				searchRef.current?.select()
			} else if (
				// j/k from anywhere outside the sheet; arrows only from the page itself, so they still scroll and step controls.
				((event.key === "j" || event.key === "k") &&
					!(event.target instanceof Element && event.target.closest("[data-sheet]"))) ||
				((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target === document.body)
			) {
				const row = document.querySelector<HTMLElement>('[data-sheet] tbody tr[tabindex="0"]')
				if (row) {
					event.preventDefault()
					row.focus()
				}
			}
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [])

	const noun = config.noun
	const noData = data.source.lastSuccess === null && data.rows.length === 0
	const pinnedRows = view.pins
		.map((id) => data.rows.find((row) => row.externalId === id))
		.filter((row) => row !== undefined)

	const presets =
		config.presets.length > 1 ? (
			<Segmented
				label="Zestaw kolumn"
				value={view.preset.id}
				onChange={(id) => update(presetPatch(config, view, id))}
				options={config.presets.map((p) => ({ value: p.id, label: p.label }))}
			/>
		) : null

	return (
		<main className="flex h-[calc(100dvh-var(--header-h))] flex-col">
			<div className="mx-auto w-full max-w-[1600px] shrink-0 space-y-2.5 px-4 pt-3 pb-2.5">
				<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<h1 className="text-[17px] font-semibold tracking-[-0.01em]">
						{kind === "crypto" ? (
							<>
								Kryptowaluty <span className="text-muted font-normal">· {SOURCES[source].name}</span>
							</>
						) : (
							config.title
						)}
					</h1>
					<span className="num text-muted text-[13px]">
						{hasFilters(view)
							? `${rows.length} z ${data.rows.length} ${countNoun(data.rows.length, noun)}`
							: `${data.rows.length} ${countNoun(data.rows.length, noun)}`}
					</span>
					{hasFilters(view) ? (
						<TextButton onClick={() => update(CLEAR_FILTERS)} className="-mx-1 h-auto px-1 max-sm:hidden sm:h-auto">
							Wyczyść filtry
						</TextButton>
					) : null}
					{noData ? null : (
						<Tooltip>
							<TooltipTrigger asChild>
								<span
									tabIndex={0}
									className={cn("num text-[13px] outline-none", fresh.warn ? "text-warn-fg font-medium" : "text-muted")}
								>
									{fresh.warn ? <StatusDot warn className="mr-1.5 mb-px" /> : null}
									{fresh.line}
								</span>
							</TooltipTrigger>
							<TooltipContent className="max-w-sm">
								{fresh.detail}
								{otherDates > 0
									? ` ${otherDates} ${countNoun(otherDates, noun)} z inną datą wyceny ma ją podaną pod nazwą.`
									: ""}
							</TooltipContent>
						</Tooltip>
					)}
					{presets ? <div className="ml-auto max-sm:hidden">{presets}</div> : null}
				</div>

				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<SearchBox
						inputRef={searchRef}
						value={search.q ?? ""}
						onChange={(q) => update({ q: q.trim() || undefined })}
						placeholder={config.kind === "fund" ? "Szukaj: nazwa, kod" : "Szukaj: nazwa, symbol"}
						className="min-w-0 flex-1 sm:w-56 sm:flex-none"
					/>
					<div className="flex items-center gap-2 sm:hidden">
						<FiltersSheet config={config} rows={data.rows} view={view} update={update} shown={rows.length} />
						<SortMenu view={view} onSort={(sort, desc) => update({ sort, dir: desc ? "desc" : "asc" })} />
					</div>
					<div className="hidden sm:contents">
						<FilterRow config={config} rows={data.rows} view={view} update={update} />
					</div>
				</div>

				{config.presets.length > 1 ? (
					<Segmented
						label="Zestaw kolumn"
						value={view.preset.id}
						onChange={(id) => update(presetPatch(config, view, id))}
						options={config.presets.map((p) => ({ value: p.id, label: p.label }))}
						className="flex w-full sm:hidden [&>button]:flex-1 [&>button]:justify-center [&>button]:px-1"
					/>
				) : null}

				{pinnedRows.length > 0 ? (
					<div className="flex flex-wrap items-center gap-1.5 text-[13px]">
						<span className="text-muted inline-flex items-center gap-1 text-xs">
							<Pin className="size-3" /> Porównanie
						</span>
						{pinnedRows.map((row) => (
							<span
								key={row.externalId}
								className="bg-panel inline-flex h-11 max-w-60 items-center rounded-md border pl-2 sm:h-7"
							>
								<Link
									to="/$kind/$source/$externalId"
									params={{ kind, source, externalId: row.externalId }}
									search={search}
									className="truncate hover:underline"
								>
									{row.name}
								</Link>
								<button
									type="button"
									aria-label={`Odepnij ${row.name}`}
									onClick={() => pin(row.externalId)}
									className="text-muted hover:text-fg inline-flex h-full w-11 shrink-0 items-center justify-center sm:w-7"
								>
									<X className="size-3" />
								</button>
							</span>
						))}
						<span className="text-muted text-xs max-sm:hidden">— otwórz dowolny wiersz, żeby porównać wykresy</span>
					</div>
				) : null}
			</div>

			<SheetScroller id={`sheet-${source}`}>
				{noData ? (
					<NoDataYet
						source={source}
						error={data.source.lastRun?.status === "failed" ? data.source.lastRun.error : null}
					/>
				) : (
					<div className="@container mx-auto max-w-[1600px]">
						<Sheet
							config={config}
							rows={rows}
							view={view}
							search={search}
							asOf={asOf}
							onSort={(id) => update(sortPatch(view, id))}
							onTogglePin={pin}
							onOpen={open}
							risk={risk}
							empty={
								<div className="space-y-2">
									<p className="text-[13px]">Żaden wiersz nie pasuje do filtrów.</p>
									<TextButton className="text-accent -ml-2" onClick={() => update(CLEAR_FILTERS)}>
										Wyczyść filtry
									</TextButton>
								</div>
							}
						/>
						<Footer source={source} collected={data.source.lastSuccess?.finishedAt ?? null} className="px-4" />
					</div>
				)}
			</SheetScroller>
		</main>
	)
}

function NoDataYet({ source, error }: { readonly source: SourceId; readonly error: string | null }) {
	return (
		<div className="mx-auto max-w-[1600px] px-4 py-10">
			<div className="border-warn/40 bg-panel max-w-xl rounded-lg border p-4">
				<p className="font-medium">Jeszcze nie ma danych z {SOURCES[source].name}.</p>
				<p className="text-muted mt-1 text-[13px]">
					Kolektor nie zakończył pierwszego pobrania. Tabela pojawi się po pierwszym udanym przebiegu.
				</p>
				{error ? <p className="text-warn-fg mt-2 text-[13px] break-words">Ostatnia próba: {error}</p> : null}
			</div>
		</div>
	)
}
