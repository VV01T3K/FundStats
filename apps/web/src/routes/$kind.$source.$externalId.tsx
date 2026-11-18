import type { InstrumentHistory, SnapshotRow } from "@fundstats/shared/api"
import { SOURCES } from "@fundstats/shared/sources"
import { useQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { ArrowLeft, Pin, X } from "lucide-react"

import { cn } from "#/lib/utils"
import { HISTORY_LIMIT, historyQuery, latestQuery } from "#/web/api.ts"
import { Segmented } from "#/web/components/controls.tsx"
import { Footer } from "#/web/components/Footer.tsx"
import { type ChartSeries, PriceChart } from "#/web/components/PriceChart.tsx"
import { formatCell } from "#/web/components/Sheet.tsx"
import {
	countNoun,
	epochToIso,
	formatCaptured,
	formatCapturedDate,
	formatCapturedFull,
	formatCompact,
	formatDate,
	formatEpochDay,
	formatPrice,
} from "#/web/format.ts"
import { heatStep } from "#/web/heat.ts"
import { coveredRanges, isRangeId, pickRange, rebase, type RangeId, sliceRange, toPoints } from "#/web/history.ts"
import { MAX_PINS, resolvePins, togglePin } from "#/web/search.ts"
import { categoryLabel, fundFamily, fundRisk, fundRiskName, getTable, longName, marketRank } from "#/web/tables.ts"

export const Route = createFileRoute("/$kind/$source/$externalId")({
	validateSearch: (raw: Record<string, unknown>): { range?: RangeId | undefined } =>
		isRangeId(raw.range) ? { range: raw.range } : {},
	// The instrument is known by its history, so a link still opens after it drops out of the latest ranking.
	loader: async ({ context, params }) => {
		const history = await context.queryClient.ensureQueryData(historyQuery(params.source, params.externalId))
		if (history === null) throw notFound()
		return { name: history.name }
	},
	head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.name ?? "Instrument"} · FundStats` }] }),
	component: InstrumentPage,
})

/** The instrument as its newest stored point describes it, for when the latest ranking no longer lists it. */
const fromHistory = (history: InstrumentHistory): SnapshotRow => {
	const newest = history.points[0]
	return {
		instrumentId: 0,
		externalId: history.externalId,
		name: history.name,
		symbol: null,
		category: null,
		currency: null,
		metadata: {},
		capturedAt: newest?.capturedAt ?? "",
		asOf: newest?.asOf ?? null,
		value: newest?.value ?? null,
		metrics: newest?.metrics ?? {},
	}
}

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"]
const NOTOWANIE = { one: "notowanie", few: "notowania", many: "notowań" }

/** Price of one instrument, or every series rebased to 100 at their first shared date. */
const buildChart = (main: ChartSeries, compared: ReadonlyArray<ChartSeries>) => {
	if (compared.length === 0) return { mode: "price" as const, series: [main], base: null, disjoint: false }
	const rebased = rebase([main, ...compared].map((s) => s.points))
	if (!rebased) return { mode: "price" as const, series: [main], base: null, disjoint: true }
	return {
		mode: "index" as const,
		base: rebased.base,
		series: [main, ...compared].map((s, i) => ({ ...s, points: rebased.series[i]! })),
		disjoint: false,
	}
}

function InstrumentPage() {
	const { kind, source, externalId } = Route.useParams()
	const search = Route.useSearch()
	const navigate = Route.useNavigate()
	const config = getTable(source)
	const fund = config.kind === "fund"
	const currency = SOURCES[source].currency
	const { data: latest } = useSuspenseQuery(latestQuery(source))
	const { data } = useSuspenseQuery(historyQuery(source, externalId))
	// The loader turns a missing history into a 404; a refetch keeps the stored instrument.
	const history = data!
	const listed = latest.rows.find((r) => r.externalId === externalId)
	const row = listed ?? fromHistory(history)

	const pins = resolvePins(search.pin, latest.rows)
	const otherRows = pins.filter((id) => id !== externalId).map((id) => latest.rows.find((r) => r.externalId === id)!)
	const otherHistories = useQueries({ queries: otherRows.map((r) => historyQuery(source, r.externalId)) })

	const points = toPoints(config.kind, history.points)
	const range = pickRange(points, search.range)
	const ranges = coveredRanges(points)
	const end = points.at(-1)?.t ?? 0

	const chart = buildChart(
		{ id: externalId, name: row.name, color: SERIES_COLORS[0]!, points: sliceRange(points, range, end) },
		otherRows.flatMap((r, i): Array<ChartSeries> => {
			const data = otherHistories[i]?.data
			if (!data) return []
			const color = SERIES_COLORS[i + 1]!
			return [
				{ id: r.externalId, name: r.name, color, points: sliceRange(toPoints(config.kind, data.points), range, end) },
			]
		}),
	)

	const first = points[0]
	const since = first ? (fund ? formatEpochDay(first.t) : formatCapturedDate(epochToIso(first.t))) : null
	const truncated = history.points.length >= HISTORY_LIMIT
	const coverage =
		since === null
			? "brak notowań z ceną"
			: truncated
				? `ostatnie ${points.length} ${countNoun(points.length, NOTOWANIE)}, od ${since}`
				: `dane od ${since} · ${points.length} ${countNoun(points.length, NOTOWANIE)}`
	const backSearch = { ...search, range: undefined }
	const isPinned = pins.includes(externalId)
	const pinsFull = !isPinned && pins.length >= MAX_PINS
	const setPins = (next: string | undefined) =>
		navigate({ search: (prev) => ({ ...prev, pin: next }), replace: true, resetScroll: false })

	const facts = fund
		? [
				fundFamily(row) ? ["Rodzina", fundFamily(row)] : null,
				row.category ? ["Kategoria", categoryLabel(row.category)] : null,
				fundRisk(row) !== null
					? ["Ryzyko", `${fundRisk(row)}/7${fundRiskName(row) ? ` · ${fundRiskName(row)}` : ""}`]
					: null,
				row.asOf ? ["Wycena", formatDate(row.asOf)] : null,
				row.symbol ? ["Kod mBank", row.symbol] : null,
			]
		: [
				marketRank(row) !== null ? ["Pozycja", `#${marketRank(row)}`] : null,
				typeof row.metadata.marketCap === "number"
					? ["Kapitalizacja", `${formatCompact(row.metadata.marketCap)} ${currency}`]
					: null,
				row.capturedAt ? ["Pobrano", formatCaptured(row.capturedAt)] : null,
			]
	const returns = config.periods.filter((c) => c.value(row) !== null || fund)
	// The tiles sit three to a row on phones; blank tiles complete the last row so every tile is one width.
	const fillers = (3 - (returns.length % 3)) % 3

	return (
		<main className="mx-auto w-full max-w-[1600px] px-4 pt-3 pb-4">
			<Link
				to="/$kind/$source"
				params={{ kind, source }}
				search={backSearch}
				className="text-muted hover:text-fg -ml-1 inline-flex h-11 items-center gap-1.5 px-1 text-[13px] sm:h-8"
			>
				<ArrowLeft className="size-3.5" />
				{fund ? "Fundusze mBank" : `Kryptowaluty · ${SOURCES[source].name}`}
			</Link>

			<header className="mt-1 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
				<div className="max-w-3xl min-w-0">
					<h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-balance">
						{history.name}
						{!fund && row.symbol ? <span className="text-muted ml-2 text-[15px] font-normal">{row.symbol}</span> : null}
					</h1>
					{fund && longName(row) && longName(row) !== row.name ? (
						<p className="text-muted mt-0.5 text-[13px]">{longName(row)}</p>
					) : null}
					{listed ? null : (
						<p className="text-warn-fg mt-1 text-[13px]">
							Nie ma go w ostatnim pobraniu z {SOURCES[source].name}; poniżej jego ostatnie zapisane dane.
						</p>
					)}
					<dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
						{facts
							.filter((fact) => fact !== null)
							.map(([label, value]) => (
								<div key={label} className="flex gap-1.5">
									<dt className="text-muted">{label}</dt>
									<dd className="num">{value}</dd>
								</div>
							))}
					</dl>
				</div>
				<div className="flex items-end gap-4">
					<div className="sm:text-right">
						<div className="text-muted text-xs">{fund ? "Wartość j.u." : "Cena"}</div>
						<div className="num text-[22px] leading-tight font-semibold tracking-[-0.01em]">
							{row.value === null ? "–" : formatPrice(row.value)}{" "}
							<span className="text-muted text-[15px] font-normal">{currency}</span>
						</div>
					</div>
					<button
						type="button"
						disabled={pinsFull || !listed}
						aria-pressed={isPinned}
						onClick={() => setPins(togglePin(pins, externalId))}
						title={pinsFull ? `Można przypiąć najwyżej ${MAX_PINS}` : undefined}
						className={cn(
							"inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors duration-150 disabled:opacity-40 sm:h-8",
							isPinned ? "border-accent/25 bg-accent-soft text-accent font-medium" : "hover:bg-hover",
						)}
					>
						<Pin className={cn("size-3.5", isPinned && "fill-current")} />
						{isPinned ? "Przypięty" : "Przypnij"}
					</button>
				</div>
			</header>

			<section
				aria-label="Stopy zwrotu"
				className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-[var(--rule)] sm:inline-flex sm:max-w-full"
			>
				{returns.map((column) => {
					const value = column.value(row)
					const heat = column.heatCap === null ? 0 : heatStep(value, column.heatCap)
					return (
						<div
							key={column.id}
							data-heat={heat === 0 ? undefined : heat}
							title={column.title}
							className={cn("min-w-0 px-3 py-2 sm:w-32", heat === 0 && "bg-bg")}
						>
							<div className="text-muted truncate text-xs">{column.label}</div>
							<div className={cn("num mt-0.5 text-[15px]", column.format === "momentum" && "font-semibold")}>
								{value === null ? <span className="text-muted">–</span> : formatCell(column, value)}
							</div>
						</div>
					)
				})}
				{Array.from({ length: fillers }, (_, i) => (
					<div key={`filler-${i}`} aria-hidden className="bg-bg sm:hidden" />
				))}
			</section>

			<section aria-label="Wykres" className="mt-6">
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						{ranges.length > 1 ? (
							<Segmented
								label="Zakres wykresu"
								value={range}
								onChange={(next) =>
									navigate({ search: (prev) => ({ ...prev, range: next }), replace: true, resetScroll: false })
								}
								options={ranges.map((r) => ({ value: r.id, label: r.label }))}
							/>
						) : null}
						<span className="num text-muted text-[13px]">{coverage}</span>
					</div>
					<Legend series={chart.series} onRemove={(id) => setPins(togglePin(pins, id))} mainId={externalId} />
				</div>
				<div className="mt-3">
					{points.length < 2 ? (
						<div className="bg-panel flex h-56 flex-col items-start justify-center gap-1 rounded-lg border px-5 text-[13px]">
							<p className="font-medium">Za mało historii na wykres.</p>
							<p className="text-muted max-w-prose">
								{points.length === 1
									? `FundStats ma na razie jedno notowanie (${since}). Linia pojawi się po kolejnych pobraniach; ${fund ? "fundusze są wyceniane raz na dzień roboczy" : "kolektor pobiera notowania co kilka godzin"}.`
									: "Brak notowań z ceną."}
							</p>
						</div>
					) : (
						<>
							{chart.mode === "index" && chart.base !== null ? (
								<p className="text-muted mb-1 text-xs">
									indeks 100 = {fund ? formatEpochDay(chart.base) : formatCapturedFull(epochToIso(chart.base))}
								</p>
							) : (
								<p className="text-muted mb-1 text-xs">
									{fund ? "Wartość j.u." : "Cena"}, {currency}
									{chart.disjoint ? " · porównywane instrumenty nie mają wspólnych dat w tym zakresie" : ""}
								</p>
							)}
							<PriceChart series={chart.series} mode={chart.mode} unit={currency} kind={config.kind} />
						</>
					)}
				</div>
				{otherRows.length === 0 ? (
					<p className="text-muted mt-3 text-xs">
						Porównanie: przypnij w tabeli maksymalnie {MAX_PINS} {countNoun(MAX_PINS, config.noun)} (pinezka przy nazwie
						albo klawisz p), a pojawią się tu jako dodatkowe linie.
					</p>
				) : null}
			</section>
			<Footer source={source} collected={latest.source.lastSuccess?.finishedAt ?? null} />
		</main>
	)
}

function Legend({
	series,
	mainId,
	onRemove,
}: {
	readonly series: ReadonlyArray<ChartSeries>
	readonly mainId: string
	readonly onRemove: (id: string) => void
}) {
	if (series.length < 2) return null
	return (
		<ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" aria-label="Legenda">
			{series.map((s) => (
				<li key={s.id} className="flex max-w-64 items-center gap-1.5">
					<span aria-hidden className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: s.color }} />
					<span className="truncate">{s.name}</span>
					{s.id === mainId ? null : (
						<button
							type="button"
							aria-label={`Usuń ${s.name} z porównania`}
							onClick={() => onRemove(s.id)}
							className="text-muted hover:text-fg inline-flex size-11 shrink-0 items-center justify-center rounded sm:size-7"
						>
							<X className="size-3" />
						</button>
					)}
				</li>
			))}
		</ul>
	)
}
