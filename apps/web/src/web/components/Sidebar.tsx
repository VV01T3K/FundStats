import type { SourceStatus } from "@fundstats/shared/api"
import { KIND_SEGMENT, SOURCE_IDS, SOURCES, type SourceId } from "@fundstats/shared/sources"
import { Link } from "@tanstack/react-router"
import {
	Bell,
	BookOpen,
	BriefcaseBusiness,
	ChartCandlestick,
	Coins,
	Download,
	Flame,
	KeyRound,
	Landmark,
	LayoutDashboard,
	LogIn,
	type LucideIcon,
	Star,
	TrendingUp,
	X,
} from "lucide-react"
import type { RefObject } from "react"

import { cn } from "#/lib/utils"

import { formatInterval } from "../format.ts"
import { sourceState, stateDetail, type SourceState } from "../freshness.ts"
import { usePrefs } from "../PrefsContext.tsx"
import { SoonBadge, soonLabel, Tip } from "./Tip.tsx"
import { Wordmark } from "./Wordmark.tsx"

const SOURCE_ICONS: Record<SourceId, LucideIcon> = {
	mbank: Landmark,
	coingecko: Coins,
	coinpaprika: Flame,
	coinmarketcap: ChartCandlestick,
}

const STATE_COLOR: Record<SourceState, string> = {
	live: "bg-up",
	cached: "bg-warm",
	stale: "bg-down",
	empty: "bg-dim",
}

/** Features without a backend yet: listed, disabled, each saying so. */
const SOON: ReadonlyArray<{ readonly label: string; readonly icon: LucideIcon }> = [
	{ label: "Dashboard", icon: LayoutDashboard },
	{ label: "Watchlist", icon: Star },
	{ label: "Portfolio", icon: BriefcaseBusiness },
	{ label: "Alerts", icon: Bell },
	{ label: "Reports", icon: TrendingUp },
	{ label: "Export CSV", icon: Download },
	{ label: "API Keys", icon: KeyRound },
]

export interface SidebarProps {
	readonly dialog: RefObject<HTMLDialogElement | null>
	readonly source: SourceId
	readonly statuses: ReadonlyArray<SourceStatus>
	readonly onClose: () => void
}

/**
 * The overlay sidebar (variants/v1-sidebar.jsx): closed by default, opened from the header's menu
 * button over a backdrop, so the table always has the full width. A native modal `<dialog>`: the
 * browser makes the page inert, traps focus, closes on Esc and returns focus to the menu button.
 */
export function Sidebar({ dialog, source, statuses, onClose }: SidebarProps) {
	const { prefs, update } = usePrefs()
	const close = () => dialog.current?.close()

	return (
		<dialog
			ref={dialog}
			aria-label="Menu"
			className="drawer"
			onClose={onClose}
			// Clicking the backdrop closes it where `closedby` is supported; Esc closes it everywhere.
			{...{ closedby: "any" }}
		>
			<div className="flex h-full flex-col overflow-y-auto overscroll-contain">
				<div className="border-rule flex shrink-0 items-center gap-3 border-b px-[18px] pt-3.5 pb-2.5">
					<Wordmark size={22} />
					<div className="flex-1" />
					<button
						type="button"
						onClick={close}
						aria-label="Close menu"
						className="border-rule text-dim hover:border-rule-strong hover:text-ink grid size-[26px] place-items-center border max-lg:size-11"
					>
						<X aria-hidden className="size-3.5" />
					</button>
				</div>

				<Section title="Source status">
					<ul>
						{SOURCE_IDS.map((id) => {
							const status = statuses.find((s) => s.id === id)
							const state = status ? sourceState(status) : "empty"
							const Icon = SOURCE_ICONS[id]
							const active = id === source
							return (
								<li key={id} className="mb-1">
									<Tip label={status ? stateDetail(status) : "No status yet."} side="right">
										<Link
											to="/$kind/$source"
											params={{ kind: KIND_SEGMENT[SOURCES[id].kind], source: id }}
											aria-current={active ? "page" : undefined}
											viewTransition
											onClick={close}
											className={cn(
												"flex min-h-9 w-full items-center gap-2.5 border px-2.5 text-[12px] max-lg:min-h-11",
												active
													? "border-rule bg-panel font-semibold text-ink"
													: "border-transparent text-dim hover:bg-panel hover:text-ink",
											)}
										>
											<span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATE_COLOR[state])} />
											<Icon aria-hidden className={cn("size-3.5 shrink-0", active && "text-warm")} />
											<span className="flex-1 truncate">{id === "mbank" ? "mBank · funds" : SOURCES[id].name}</span>
											<span className="text-dim text-[11px] font-normal">
												{status
													? state === "stale" || state === "empty"
														? state.toUpperCase()
														: `every ${formatInterval(status.intervalSeconds)}`
													: ""}
											</span>
										</Link>
									</Tip>
								</li>
							)
						})}
					</ul>
				</Section>

				<Section title="Display">
					<Choice
						label="SOON FEATURES"
						options={[
							{ id: "show", label: "SHOW" },
							{ id: "hide", label: "HIDE" },
						]}
						value={prefs.showSoon ? "show" : "hide"}
						onChange={(choice) => update({ ...prefs, showSoon: choice === "show" })}
					/>
				</Section>

				<Section title="Navigate">
					<a href="/api/docs" className={rowClass("text-dim hover:text-ink")}>
						<BookOpen aria-hidden className="size-3.5" />
						<span className="flex-1">API docs</span>
					</a>
					{(prefs.showSoon ? SOON : []).map(({ label, icon: Icon }) => (
						<Tip key={label} label={soonLabel(label)} side="right">
							<button type="button" aria-disabled="true" className={rowClass("cursor-not-allowed text-dim")}>
								<Icon aria-hidden className="size-3.5 opacity-70" />
								<span className="flex-1">{label}</span>
								<SoonBadge />
							</button>
						</Tip>
					))}
				</Section>

				<div className="flex-1" />
				<div className="border-rule border-t px-[18px] py-3">
					{prefs.showSoon ? (
						<Tip label={soonLabel("Accounts and sign-in")} side="top">
							<button type="button" aria-disabled="true" className={rowClass("cursor-not-allowed text-ink-dim")}>
								<LogIn aria-hidden className="size-3.5" />
								<span className="flex-1">Sign in</span>
								<SoonBadge />
							</button>
						</Tip>
					) : null}
					<div className="text-dim mt-2 text-[11px]">
						<div>FundStats Terminal · v{__APP_VERSION__}</div>
						<a href="https://github.com/VV01T3K/FundStats" className="hover:text-ink mt-0.5 inline-block">
							github.com/VV01T3K/FundStats
						</a>
					</div>
				</div>
			</div>
		</dialog>
	)
}

const rowClass = (extra: string) =>
	cn(
		"-mx-2 flex min-h-8 w-[calc(100%+16px)] items-center gap-2.5 px-2 text-left text-[12px] tracking-[0.02em] max-lg:min-h-11",
		extra,
	)

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
	return (
		<section className="border-rule shrink-0 border-b px-[18px] py-3.5">
			<h2 className="text-dim mb-2.5 text-[11px] font-normal tracking-[0.12em] uppercase">{title}</h2>
			{children}
		</section>
	)
}

/** A labelled segmented control: one of `options`, the chosen one filled amber. */
function Choice<Id extends string>({
	label,
	options,
	value,
	onChange,
}: {
	readonly label: string
	readonly options: ReadonlyArray<{ readonly id: Id; readonly label: string }>
	readonly value: Id
	readonly onChange: (id: Id) => void
}) {
	const labelId = `choice-${label.toLowerCase().replaceAll(" ", "-")}`
	return (
		<div className="mb-3.5 last:mb-0">
			<div id={labelId} className="text-dim mb-1 text-[11px]">
				{label}
			</div>
			<div role="radiogroup" aria-labelledby={labelId} className="border-rule flex border">
				{options.map((option, i) => {
					const on = value === option.id
					return (
						<button
							key={option.id}
							type="button"
							role="radio"
							aria-checked={on}
							onClick={() => onChange(option.id)}
							className={cn(
								"h-7 flex-1 text-[11px] transition-colors max-lg:h-11",
								i > 0 && "border-l border-rule",
								on ? "bg-warm font-bold text-on-accent" : "text-dim hover:bg-panel hover:text-ink",
							)}
						>
							{option.label}
						</button>
					)
				})}
			</div>
		</div>
	)
}
