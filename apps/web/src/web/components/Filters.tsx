import type { SnapshotRow } from "@fundstats/shared/api"
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react"
import { Dialog, Popover } from "radix-ui"
import { type KeyboardEvent, type Ref, useMemo, useState } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { cn } from "#/lib/utils"

import { countNoun } from "../format.ts"
import { riskScale } from "../risk.ts"
import {
	CLEAR_FILTERS,
	familiesOf,
	filterRows,
	fold,
	hasFilters,
	type ResolvedView,
	type TableSearch,
	toggleRisk,
} from "../search.ts"
import { FUND_CATEGORIES, fundRisk, NAME_COLUMN, RANK_COLUMN, type TableConfig } from "../tables.ts"
import { Count, IconButton, TextButton, Toggle } from "./controls.tsx"
import { RiskMeter } from "./RiskLevel.tsx"

type Update = (patch: Partial<TableSearch>) => void

export function SearchBox({
	value,
	onChange,
	inputRef,
	placeholder,
	className,
}: {
	readonly value: string
	readonly onChange: (value: string) => void
	readonly inputRef: Ref<HTMLInputElement>
	readonly placeholder: string
	readonly className?: string
}) {
	// The field edits a draft; the URL gets the trimmed text. A change from outside (clearing the
	// filters, going back) replaces the draft unless it is the same search.
	const [draft, setDraft] = useState(value)
	const [seen, setSeen] = useState(value)
	if (value !== seen) {
		setSeen(value)
		if (draft.trim() !== value) setDraft(value)
	}
	const change = (next: string) => {
		setDraft(next)
		onChange(next)
	}
	return (
		<label className={cn("relative flex items-center", className)}>
			<span className="sr-only">Szukaj</span>
			<Search aria-hidden className="text-muted pointer-events-none absolute left-2.5 size-3.5" />
			<input
				ref={inputRef}
				type="search"
				value={draft}
				onChange={(event) => change(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return
					if (draft) change("")
					else event.currentTarget.blur()
				}}
				placeholder={placeholder}
				autoComplete="off"
				spellCheck={false}
				maxLength={100}
				className="bg-bg placeholder:text-muted focus:border-accent h-11 w-full rounded-md border pr-8 pl-8 text-[13px] outline-none sm:h-8 [&::-webkit-search-cancel-button]:hidden"
			/>
			{draft ? (
				<button
					type="button"
					aria-label="Wyczyść wyszukiwanie"
					onClick={() => change("")}
					className="text-muted hover:text-fg absolute right-0 inline-flex size-11 items-center justify-center sm:right-1 sm:size-6"
				>
					<X className="size-3.5" />
				</button>
			) : (
				<kbd className="text-muted pointer-events-none absolute right-2 rounded border px-1 text-[10px] leading-4 max-sm:hidden">
					/
				</kbd>
			)}
		</label>
	)
}

/** Option counts computed with every other filter applied, so a count says what a click would show. */
const useFacets = (rows: ReadonlyArray<SnapshotRow>, view: ResolvedView) =>
	useMemo(() => {
		const byCategory = filterRows(rows, view, "category")
		const categories = new Map<string, number>()
		for (const row of byCategory)
			if (row.category) categories.set(row.category, (categories.get(row.category) ?? 0) + 1)
		const risks = new Map<number, number>()
		for (const row of filterRows(rows, view, "risk")) {
			const risk = fundRisk(row)
			if (risk !== null) risks.set(risk, (risks.get(risk) ?? 0) + 1)
		}
		return {
			categoryTotal: byCategory.length,
			categories,
			scale: riskScale(rows),
			risks,
			families: familiesOf(filterRows(rows, view, "family")),
		}
	}, [rows, view])

function CategoryChips({
	facets,
	view,
	update,
}: {
	readonly facets: ReturnType<typeof useFacets>
	readonly view: ResolvedView
	readonly update: Update
}) {
	return (
		<div role="group" aria-label="Kategoria" className="flex flex-wrap items-center gap-0.5">
			<Toggle pressed={view.category === null} onClick={() => update({ category: undefined })}>
				Wszystkie <Count>{facets.categoryTotal}</Count>
			</Toggle>
			{FUND_CATEGORIES.map((category) => (
				<Toggle
					key={category.value}
					pressed={view.category === category.value}
					onClick={() => update({ category: view.category === category.value ? undefined : category.value })}
				>
					{category.plural} <Count>{facets.categories.get(category.value) ?? 0}</Count>
				</Toggle>
			))}
		</div>
	)
}

function RiskFilter({
	facets,
	view,
	update,
}: {
	readonly facets: ReturnType<typeof useFacets>
	readonly view: ResolvedView
	readonly update: Update
}) {
	if (facets.scale.length === 0) return null
	const max = facets.scale.at(-1)!.level
	return (
		<div role="group" aria-label="Ryzyko (skala mBanku)" className="flex shrink-0 flex-wrap items-center gap-0.5">
			<span className="text-muted mr-1 text-xs">Ryzyko</span>
			{facets.scale.map(({ level, name, short }) => {
				const count = facets.risks.get(level) ?? 0
				const pressed = view.risk.has(level)
				const chip = (
					<Toggle
						key={level}
						pressed={pressed}
						disabled={count === 0 && !pressed}
						onClick={() => update({ risk: toggleRisk(view.risk, level) })}
					>
						<RiskMeter level={level} max={max} />
						<span aria-hidden>{short}</span>
						<span className="sr-only">{name}</span> <Count>{count}</Count>
					</Toggle>
				)
				return short === name ? (
					chip
				) : (
					<Tooltip key={level}>
						<TooltipTrigger asChild>{chip}</TooltipTrigger>
						<TooltipContent side="bottom">Ryzyko według mBanku: {name}</TooltipContent>
					</Tooltip>
				)
			})}
		</div>
	)
}

function FamilyList({
	families,
	selected,
	onSelect,
}: {
	readonly families: ReadonlyMap<string, number>
	readonly selected: string | null
	readonly onSelect: (family: string | null) => void
}) {
	const [query, setQuery] = useState("")
	const options = useMemo(() => {
		const needle = fold(query.trim())
		return [...families].filter(([name]) => fold(name).includes(needle)).sort(([a], [b]) => a.localeCompare(b, "pl-PL"))
	}, [families, query])
	const onListKey = (event: KeyboardEvent<HTMLElement>) => {
		const container = event.currentTarget.closest("[data-family-list]")
		const items = [...(container?.querySelectorAll<HTMLElement>("input, button[data-family]") ?? [])]
		const index = items.indexOf(event.target as HTMLElement)
		const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 1, End: items.length - 1 }[event.key]
		if (to === undefined || index === -1) return
		event.preventDefault()
		items[Math.max(0, Math.min(items.length - 1, to))]?.focus()
	}
	const item = (active: boolean) =>
		cn(
			"flex h-11 w-full items-center gap-2 rounded px-2 text-left text-[13px] sm:h-8",
			active ? "text-accent font-medium" : "hover:bg-hover",
		)
	return (
		<div className="flex min-h-0 flex-col gap-1" data-family-list>
			<input
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && options[0]) onSelect(options[0][0])
					else if (event.key === "ArrowDown") onListKey(event)
				}}
				placeholder="Szukaj rodziny…"
				aria-label="Szukaj rodziny funduszy"
				autoComplete="off"
				className="bg-bg placeholder:text-muted focus:border-accent h-11 w-full shrink-0 rounded-md border px-2.5 text-[13px] outline-none sm:h-8 [&::-webkit-search-cancel-button]:hidden"
			/>
			<div
				role="group"
				aria-label="Rodziny funduszy"
				onKeyDown={onListKey}
				className="min-h-0 overflow-y-auto overscroll-contain"
			>
				{query === "" ? (
					<button
						type="button"
						data-family
						aria-pressed={selected === null}
						onClick={() => onSelect(null)}
						className={item(selected === null)}
					>
						<Check className={cn("size-3.5 shrink-0", selected !== null && "invisible")} />
						Wszystkie rodziny
					</button>
				) : null}
				{options.map(([name, count]) => (
					<button
						key={name}
						type="button"
						data-family
						aria-pressed={selected === name}
						onClick={() => onSelect(name)}
						className={item(selected === name)}
					>
						<Check className={cn("size-3.5 shrink-0", selected !== name && "invisible")} />
						<span className="min-w-0 flex-1 truncate">{name}</span>
						<Count>{count}</Count>
					</button>
				))}
				{options.length === 0 ? <p className="text-muted px-2 py-3 text-[13px]">Brak rodziny o tej nazwie.</p> : null}
			</div>
		</div>
	)
}

function FamilySelect({
	facets,
	view,
	update,
}: {
	readonly facets: ReturnType<typeof useFacets>
	readonly view: ResolvedView
	readonly update: Update
}) {
	const [open, setOpen] = useState(false)
	return (
		<div className="flex min-w-0 items-center">
			<Popover.Root open={open} onOpenChange={setOpen}>
				<Popover.Trigger asChild>
					<button
						type="button"
						aria-label={view.family ? `Rodzina: ${view.family}` : undefined}
						title={view.family ?? undefined}
						className={cn(
							"inline-flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors duration-150",
							view.family ? "border-accent/25 bg-accent-soft text-accent" : "text-muted hover:text-fg hover:bg-hover",
						)}
					>
						{/* The selected name replaces the label, so it truncates inside the toolbar's budget. */}
						<span className={cn("truncate", view.family && "font-medium")}>{view.family ?? "Rodzina"}</span>
						<ChevronDown className="size-3.5 shrink-0" />
					</button>
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content
						align="start"
						sideOffset={4}
						className="bg-bg z-50 flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-72 flex-col rounded-lg border p-1.5 shadow-[0_8px_24px_-6px_oklch(0_0_0/0.25)]"
					>
						<FamilyList
							families={facets.families}
							selected={view.family}
							onSelect={(family) => {
								update({ family: family ?? undefined })
								setOpen(false)
							}}
						/>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
			{view.family ? (
				<IconButton
					aria-label="Wyczyść rodzinę"
					onClick={() => update({ family: undefined })}
					className="size-7 sm:size-7"
				>
					<X className="size-3.5" />
				</IconButton>
			) : null}
		</div>
	)
}

/**
 * Wide screens: categories, then risk and family as one unit that shares the search row from `xl`
 * and below it takes a row of its own, so the toolbar never breaks mid-group.
 */
export function FilterRow({
	config,
	rows,
	view,
	update,
}: {
	readonly config: TableConfig
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly view: ResolvedView
	readonly update: Update
}) {
	const facets = useFacets(rows, view)
	if (config.kind !== "fund") return null
	return (
		<>
			<CategoryChips facets={facets} view={view} update={update} />
			<div className="flex min-w-0 items-center gap-x-2 max-xl:basis-full xl:flex-1">
				<RiskFilter facets={facets} view={view} update={update} />
				<FamilySelect facets={facets} view={view} update={update} />
			</div>
		</>
	)
}

const activeFilterCount = (view: ResolvedView) =>
	(view.category ? 1 : 0) + (view.risk.size > 0 ? 1 : 0) + (view.family ? 1 : 0)

/** Narrow screens: every filter in one sheet. */
export function FiltersSheet({
	config,
	rows,
	view,
	update,
	shown,
}: {
	readonly config: TableConfig
	readonly rows: ReadonlyArray<SnapshotRow>
	readonly view: ResolvedView
	readonly update: Update
	readonly shown: number
}) {
	const facets = useFacets(rows, view)
	if (config.kind !== "fund") return null
	const count = activeFilterCount(view)
	return (
		<Dialog.Root>
			<Dialog.Trigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px]",
						count > 0 ? "border-accent/25 bg-accent-soft text-accent font-medium" : "text-fg",
					)}
				>
					<SlidersHorizontal className="size-4" />
					Filtry
					{count > 0 ? <span className="num">{count}</span> : null}
				</button>
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-0 z-40 bg-[oklch(0.1_0.01_255/0.45)]" />
				<Dialog.Content className="bg-bg data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-xl border-t pb-[env(safe-area-inset-bottom)] duration-200">
					<div className="flex items-center justify-between border-b px-4 py-1">
						<Dialog.Title className="text-[15px] font-semibold">Filtry</Dialog.Title>
						<Dialog.Close asChild>
							<IconButton aria-label="Zamknij filtry">
								<X className="size-4" />
							</IconButton>
						</Dialog.Close>
					</div>
					<Dialog.Description className="sr-only">Kategoria, ryzyko i rodzina funduszy</Dialog.Description>
					<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
						<section className="space-y-2">
							<h3 className="text-muted text-xs font-medium">Kategoria</h3>
							<CategoryChips facets={facets} view={view} update={update} />
						</section>
						<section className="space-y-2">
							<RiskFilter facets={facets} view={view} update={update} />
						</section>
						<section className="flex min-h-64 flex-col gap-2">
							<h3 className="text-muted text-xs font-medium">Rodzina</h3>
							<FamilyList
								families={facets.families}
								selected={view.family}
								onSelect={(family) => update({ family: family ?? undefined })}
							/>
						</section>
					</div>
					<div className="flex items-center gap-2 border-t px-4 py-3">
						{hasFilters(view) ? <TextButton onClick={() => update(CLEAR_FILTERS)}>Wyczyść</TextButton> : null}
						<Dialog.Close asChild>
							<button
								type="button"
								className="bg-accent text-accent-fg ml-auto h-11 rounded-md px-4 text-[13px] font-medium"
							>
								Pokaż {shown} {countNoun(shown, config.noun)}
							</button>
						</Dialog.Close>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}

/** Narrow screens: headers scroll away sideways, so sorting gets its own control (a native picker). */
export function SortMenu({
	view,
	onSort,
}: {
	readonly view: ResolvedView
	readonly onSort: (columnId: string, desc: boolean) => void
}) {
	const columns = [
		{ id: NAME_COLUMN, label: "Nazwa", text: true },
		...view.columns.map((c) => ({ id: c.id, label: c.id === RANK_COLUMN ? "Pozycja" : c.label, text: false })),
	]
	const label = (text: boolean, desc: boolean) =>
		text ? (desc ? "Z–A" : "A–Z") : desc ? "od najwyższej" : "od najniższej"
	const current = columns.find((c) => c.id === view.sort)
	return (
		<label
			className="text-fg focus-within:outline-accent relative inline-flex size-11 shrink-0 items-center justify-center rounded-md border focus-within:outline-2"
			title={current ? `Sortowanie: ${current.label}, ${label(current.text, view.desc)}` : undefined}
		>
			{view.desc ? (
				<ArrowDownWideNarrow aria-hidden className="size-4" />
			) : (
				<ArrowUpNarrowWide aria-hidden className="size-4" />
			)}
			<span className="sr-only">Sortuj według</span>
			<select
				value={`${view.sort}:${view.desc ? "desc" : "asc"}`}
				onChange={(event) => {
					const [id, dir] = event.target.value.split(":")
					if (id) onSort(id, dir === "desc")
				}}
				className="absolute inset-0 cursor-pointer appearance-none opacity-0"
			>
				{columns.flatMap((column) =>
					[true, false].map((desc) => (
						<option key={`${column.id}:${desc}`} value={`${column.id}:${desc ? "desc" : "asc"}`}>
							{column.label}, {label(column.text, desc)}
						</option>
					)),
				)}
			</select>
		</label>
	)
}
