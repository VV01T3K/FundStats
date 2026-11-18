import type { InstrumentHistory, SnapshotRow } from "@fundstats/shared/api"
import { SOURCES } from "@fundstats/shared/sources"
import { useQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { ArrowLeft, Pin, X } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "#/lib/utils"
import { HISTORY_LIMIT, historyQuery, latestQuery } from "#/web/api.ts"
import { Segmented } from "#/web/components/controls.tsx"
import { Footer } from "#/web/components/Footer.tsx"
import { type ChartSeries, PriceChart } from "#/web/components/PriceChart.tsx"
import { RiskMeter } from "#/web/components/RiskLevel.tsx"
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
import {
	clip,
	compare,
	coveredRanges,
	type Exclusion,
	GAPS,
	isRangeId,
	pickRange,
	type Point,
	type RangeId,
	rangeWindow,
	toPoints,
} from "#/web/history.ts"
import { type RiskLevel, riskScale } from "#/web/risk.ts"
import { MAX_PINS, resolvePins, togglePin } from "#/web/search.ts"
import { categoryLabel, fundFamily, fundRisk, getTable, longName, marketRank } from "#/web/tables.ts"

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

const riskFact = (level: RiskLevel, max: number) => (
	<span className="inline-flex items-center gap-1.5" title="Skala ryzyka mBanku">
		<RiskMeter level={level.level} max={max} />
		{level.name}
	</span>
)

/** Phones lay the tiles three to a row; the last one takes what its row leaves, so no slot is empty. */
const LAST_TILE_SPAN = ["", "col-span-3", "col-span-2"]

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"]
const NOTOWANIE = { one: "notowanie", few: "notowania", many: "notowań" }

/** Why a pinned instrument has no line; shown next to its name in the legend. */
const PIN_STATUS: Record<Exclusion | "loading", string> = {
	loading: "wczytywanie…",
	empty: "brak notowań w tym okresie",
	disjoint: "brak wspólnych dat",
}

interface LegendEntry {
	readonly id: string
	readonly name: string
	readonly color: string
	readonly status: string | null
}

/**
 * Price of one instrument, or the instrument and its pins rebased to 100 at a shared base. Every
 * series is first cut to the main series' window, so a pin can neither widen nor extend the range.
 */
const buildChart = (
	main: ChartSeries,
	pinned: ReadonlyArray<{ readonly id: string; readonly name: string; readonly points: ReadonlyArray<Point> | null }>,
	frame: { readonly start: number; readonly end: number },
	maxGap: number,
) => {
	const clipped = pinned.map((p) => ({ ...p, points: p.points === null ? null : clip(p.points, frame) }))
	const loaded = clipped.flatMap((p, i) => (p.points === null ? [] : [{ i, points: p.points }]))
	const result = compare(
		main.points,
		loaded.map((p) => p.points),
		maxGap,
	)
	const color = (i: number) => SERIES_COLORS[i + 1]!
	const drawn = new Map(result.others.map((o) => [loaded[o.index]!.i, o.points]))
	const legend: Array<LegendEntry> = clipped.map((p, i) => {
		const position = loaded.findIndex((l) => l.i === i)
		const exclusion = position === -1 ? "loading" : result.excluded.get(position)
		return { id: p.id, name: p.name, color: color(i), status: exclusion ? PIN_STATUS[exclusion] : null }
	})
	if (result.base === null) {
		return { mode: "price" as const, series: [main], base: null, legend }
	}
	return {
		mode: "index" as const,
		base: result.base,
		series: [
			{ ...main, points: result.main },
			...clipped.flatMap((p, i): Array<ChartSeries> => {
				const points = drawn.get(i)
				return points ? [{ id: p.id, name: p.name, color: color(i), points }] : []
			}),
		],
		legend,
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
	const scale = riskScale(latest.rows)
	const riskLevel = scale.find((r) => r.level === fundRisk(row))
	const otherRows = pins.filter((id) => id !== externalId).map((id) => latest.rows.find((r) => r.externalId === id)!)
	const otherHistories = useQueries({ queries: otherRows.map((r) => historyQuery(source, r.externalId)) })

	const points = toPoints(config.kind, history.points)
	const range = pickRange(points, search.range)
	const ranges = coveredRanges(points)
	const frame = rangeWindow(range, points.at(-1)?.t ?? 0)

	const chart = buildChart(
		{ id: externalId, name: history.name, color: SERIES_COLORS[0]!, points: clip(points, frame) },
		otherRows.map((r, i) => {
			const data = otherHistories[i]?.data
			return { id: r.externalId, name: r.name, points: data ? toPoints(config.kind, data.points) : null }
		}),
		frame,
		GAPS[config.kind].hover,
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

	const facts: ReadonlyArray<readonly [string, ReactNode] | null> = fund
		? [
				fundFamily(row) ? ["Rodzina", fundFamily(row)] : null,
				row.category ? ["Kategoria", categoryLabel(row.category)] : null,
				riskLevel ? ["Ryzyko", riskFact(riskLevel, scale.at(-1)!.level)] : null,
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
						<p className="text-muted mt-1 max-w-prose text-[13px]">
							Nie ma go w ostatnim pobraniu z {SOURCES[source].name}, więc{" "}
							{fund ? "rodzina, kategoria i ryzyko są" : "pozycja i kapitalizacja są"} niedostępne. Wartość i stopy
							zwrotu pochodzą z ostatniego zapisanego notowania.
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
				{returns.map((column, i) => {
					const value = column.value(row)
					const heat = column.heatCap === null ? 0 : heatStep(value, column.heatCap)
					return (
						<div
							key={column.id}
							data-heat={heat === 0 ? undefined : heat}
							title={column.title}
							className={cn(
								"min-w-0 px-3 py-2 sm:w-32",
								heat === 0 && "bg-bg",
								i === returns.length - 1 && LAST_TILE_SPAN[returns.length % 3],
							)}
						>
							<div className="text-muted truncate text-xs">{column.label}</div>
							<div className={cn("num mt-0.5 text-[15px]", column.format === "momentum" && "font-semibold")}>
								{value === null ? <span className="text-muted">–</span> : formatCell(column, value)}
							</div>
						</div>
					)
				})}
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
					<Legend
						main={{ id: externalId, name: history.name, color: SERIES_COLORS[0]!, status: null }}
						pinned={chart.legend}
						onRemove={(id) => setPins(togglePin(pins, id))}
					/>
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
									{chart.legend.length > 0 && chart.legend.every((entry) => entry.status !== PIN_STATUS.loading)
										? " · żadnego przypiętego nie da się porównać w tym zakresie"
										: ""}
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

/** The instrument and every pin, drawn or not, each removable; a pin without a line says why. */
function Legend({
	main,
	pinned,
	onRemove,
}: {
	readonly main: LegendEntry
	readonly pinned: ReadonlyArray<LegendEntry>
	readonly onRemove: (id: string) => void
}) {
	if (pinned.length === 0) return null
	return (
		<ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" aria-label="Legenda">
			{[main, ...pinned].map((entry) => (
				<li key={entry.id} className="flex max-w-80 min-w-0 items-center gap-1.5">
					<span
						aria-hidden
						className={cn("h-0.5 w-3.5 shrink-0 rounded-full", entry.status && "opacity-30")}
						style={{ background: entry.color }}
					/>
					<span className={cn("truncate", entry.status && "text-muted")}>{entry.name}</span>
					{entry.status ? <span className="text-muted shrink-0 text-xs">({entry.status})</span> : null}
					{entry === main ? null : (
						<button
							type="button"
							aria-label={`Usuń ${entry.name} z porównania`}
							onClick={() => onRemove(entry.id)}
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
