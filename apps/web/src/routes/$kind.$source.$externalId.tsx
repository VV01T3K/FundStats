import { SOURCES } from "@fundstats/shared/sources"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, notFound } from "@tanstack/react-router"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { useMemo } from "react"

import { cn } from "#/lib/utils"
import { historyQuery, HISTORY_LIMIT, latestQuery } from "#/web/api.ts"
import { PriceChart } from "#/web/components/PriceChart.tsx"
import {
	formatCompact,
	epochToIso,
	formatDate,
	formatEpochDay,
	formatInteger,
	formatPercent,
	formatPrice,
	formatStamp,
	trend,
} from "#/web/format.ts"
import { clip, coveredRanges, isRangeId, pickRange, rangeWindow, toPoints } from "#/web/history.ts"
import { refreshInterval } from "#/web/prefs.ts"
import { usePrefs } from "#/web/PrefsContext.tsx"
import {
	categoryLabel,
	fundFamily,
	fundRisk,
	fundRiskName,
	getTable,
	longName,
	marketCap,
	percentValue,
} from "#/web/tables.ts"

/**
 * One instrument: its price chart and its latest figures. Resolved through its stored history, so a
 * link keeps working after the instrument leaves the source's latest ranking.
 */
export const Route = createFileRoute("/$kind/$source/$externalId")({
	validateSearch: (raw: Record<string, unknown>): { range?: string | undefined } =>
		isRangeId(raw.range) ? { range: raw.range } : {},
	loader: async ({ context, params }) => {
		const history = await context.queryClient.ensureQueryData(historyQuery(params.source, params.externalId))
		if (history === null) throw notFound()
		return { name: history.name }
	},
	head: ({ loaderData, params }) => ({
		meta: [{ title: `${loaderData?.name ?? params.externalId} · ${SOURCES[params.source].name} · FundStats` }],
	}),
	component: DetailPage,
})

const source$ = getRouteApi("/$kind/$source")

const TREND_TEXT = { up: "text-up", down: "text-down", flat: "text-ink-dim" } as const

function DetailPage() {
	const { kind, source, externalId } = Route.useParams()
	const { range: wantedRange } = Route.useSearch()
	const navigate = Route.useNavigate()
	const { prefs } = usePrefs()
	const interval = refreshInterval(prefs.refresh)
	const { data: history } = useSuspenseQuery(historyQuery(source, externalId))
	const { data: latest } = useSuspenseQuery({ ...latestQuery(source), refetchInterval: interval })
	const config = getTable(source)
	const info = SOURCES[source]
	const row = latest.rows.find((r) => r.externalId === externalId) ?? null
	const tableSearch = source$.useSearch()

	const points = useMemo(() => toPoints(config.kind, history?.points ?? []), [config.kind, history])
	const ranges = coveredRanges(points)
	const range = pickRange(points, wantedRange)
	const shown = clip(points, rangeWindow(range, points))
	const change = shown.length >= 2 ? (shown.at(-1)!.v / shown[0]!.v - 1) * 100 : null
	const lastPoint = points.at(-1)
	const price = row?.value ?? lastPoint?.v ?? null
	const ticker = row?.symbol ?? null
	const name = history?.name ?? externalId

	const facts: Array<[string, string]> = row
		? [
				...(config.kind === "fund"
					? ([
							["Category", row.category ? categoryLabel(row.category) : "–"],
							["Risk", fundRisk(row) === null ? "–" : `${fundRisk(row)} · ${fundRiskName(row) ?? ""}`],
							["Fund family", fundFamily(row) ?? "–"],
							["Valuation date", row.asOf ? formatDate(row.asOf) : "–"],
						] satisfies Array<[string, string]>)
					: ([
							["Market cap rank", row.metrics.rank === undefined ? "–" : `#${formatInteger(row.metrics.rank)}`],
							["Market cap", marketCap(row) === null ? "–" : `${formatCompact(marketCap(row)!)} ${info.currency}`],
						] satisfies Array<[string, string]>)),
				["Collected", formatStamp(row.capturedAt)],
			]
		: []

	return (
		<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
			<div className="border-rule flex items-center gap-3 border-b px-4 py-2.5 lg:px-[18px]">
				<Link
					to="/$kind/$source"
					params={{ kind, source }}
					search={tableSearch}
					className="text-dim hover:text-ink inline-flex min-h-7 items-center gap-1.5 text-[11px] tracking-[0.06em] max-sm:min-h-11"
				>
					<ArrowLeft aria-hidden className="size-3.5" />
					BACK TO {config.title.toUpperCase()}
				</Link>
			</div>

			<section className="border-rule border-b px-4 py-5 lg:px-[18px]">
				<div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
					<div className="min-w-0">
						<div className="text-dim flex items-center gap-2.5 text-[11px] tracking-[0.1em]">
							{ticker && config.kind === "crypto" ? <span className="text-warm font-bold">{ticker}</span> : null}
							<span>{info.name.toUpperCase()}</span>
							{row?.category ? (
								<span className="border-rule-strong text-warm border px-1.5 py-px text-[10px]">
									{categoryLabel(row.category).toUpperCase()}
								</span>
							) : null}
						</div>
						<h1 className="text-ink mt-1.5 text-[20px] leading-tight font-bold text-pretty">{name}</h1>
						{row && longName(row) && longName(row) !== name ? (
							<p className="text-dim mt-1 max-w-[80ch] text-[11px]">{longName(row)}</p>
						) : null}
					</div>
					{price !== null ? (
						<div className="text-right">
							<div className="text-ink text-[28px] leading-none">
								{formatPrice(price)} <span className="text-dim text-[13px]">{row?.currency ?? info.currency}</span>
							</div>
							{change !== null ? (
								<div className={cn("mt-1.5 text-[12px]", TREND_TEXT[trend(change)])}>
									{formatPercent(change)} <span className="text-dim">over {range.toUpperCase()}</span>
								</div>
							) : null}
						</div>
					) : null}
				</div>
				{row ? null : (
					<p className="border-rule-strong text-ink-dim mt-4 border px-3 py-2 text-[11px]">
						{info.name} no longer lists this instrument in its latest ranking. The chart shows the history stored before
						it left; its latest figures are unavailable.
					</p>
				)}
			</section>

			{row ? (
				<section
					aria-label="Returns"
					className="border-rule grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] border-b"
				>
					{config.columns
						.filter((c) => c.kind === "percent")
						.map((column) => {
							const value = percentValue(column, row)
							return (
								<div key={column.id} className="border-rule border-r border-b px-4 py-3 lg:px-[18px]">
									<div className="text-dim text-[10px] tracking-[0.1em]" title={column.title}>
										{column.label}
									</div>
									<div className={cn("mt-1 text-[14px]", value === null ? "text-dim" : TREND_TEXT[trend(value)])}>
										{value === null ? "–" : formatPercent(value)}
									</div>
								</div>
							)
						})}
				</section>
			) : null}

			<section aria-label="Price chart" className="border-rule border-b px-4 py-4 lg:px-[18px]">
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<span className="text-dim mr-1 text-[11px]">Range</span>
					{ranges.map((r) => {
						const on = r.id === range
						return (
							<button
								key={r.id}
								type="button"
								aria-pressed={on}
								onClick={() =>
									navigate({ search: (prev) => ({ ...prev, range: r.id }), replace: true, resetScroll: false })
								}
								className={cn(
									"h-[26px] min-w-11 border px-2.5 text-[11px] tracking-[0.06em] max-sm:h-11",
									on ? "border-warm bg-warm font-bold text-on-accent" : "border-rule-strong text-dim hover:text-ink",
								)}
							>
								{r.label}
							</button>
						)
					})}
					<span className="text-dim ml-auto text-[10px]">
						{history && history.points.length >= HISTORY_LIMIT
							? `last ${formatInteger(HISTORY_LIMIT)} quotes`
							: `${formatInteger(points.length)} quotes`}
						{points.length > 0
							? ` since ${config.kind === "fund" ? formatEpochDay(points[0]!.t) : formatStamp(epochToIso(points[0]!.t))}`
							: ""}
					</span>
				</div>
				{shown.length >= 2 ? (
					<PriceChart points={shown} currency={row?.currency ?? info.currency} kind={config.kind} />
				) : (
					<p className="border-rule-strong text-dim grid h-40 place-items-center border border-dashed text-[11px]">
						Not enough history for a chart yet: {shown.length === 1 ? "one quote" : "no quotes"} stored.
					</p>
				)}
			</section>

			{facts.length > 0 ? (
				<section aria-label="Details" className="px-4 py-4 lg:px-[18px]">
					<dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-8 gap-y-3 text-[11px]">
						{facts.map(([term, value]) => (
							<div key={term}>
								<dt className="text-dim text-[10px] tracking-[0.1em] uppercase">{term}</dt>
								<dd className="text-ink mt-0.5">{value}</dd>
							</div>
						))}
					</dl>
					<a
						href={info.homepage}
						target="_blank"
						rel="noreferrer"
						className="text-dim hover:text-ink mt-4 inline-flex items-center gap-1.5 text-[11px]"
					>
						Source: {info.name}
						<ExternalLink aria-hidden className="size-3" />
					</a>
				</section>
			) : null}
		</div>
	)
}
