import type { ComponentProps, ReactNode } from "react"

import { cn } from "#/lib/utils"

/** Pressed-state buttons in one bordered track: presets, providers, ranges. */
export function Segmented<T extends string>({
	label,
	options,
	value,
	onChange,
	className,
}: {
	readonly label: string
	readonly options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode; readonly title?: string }>
	readonly value: T
	readonly onChange: (value: T) => void
	readonly className?: string
}) {
	return (
		<div
			role="group"
			aria-label={label}
			className={cn("bg-panel inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5", className)}
		>
			{options.map((option) => {
				const active = option.value === value
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						title={option.title}
						onClick={() => onChange(option.value)}
						className={cn(
							"inline-flex h-11 items-center gap-1.5 rounded-[5px] px-3 text-[13px] whitespace-nowrap transition-colors duration-150 sm:h-7 sm:px-2.5",
							active
								? "bg-bg text-fg font-medium shadow-[0_1px_2px_oklch(0_0_0/0.12)] ring-1 ring-rule"
								: "text-muted hover:text-fg",
						)}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}

/** A filter option that toggles: category, risk level. */
export function Toggle({
	pressed,
	className,
	children,
	...props
}: ComponentProps<"button"> & { readonly pressed: boolean }) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			className={cn(
				"inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-[13px] whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 sm:h-7 sm:px-2.5",
				pressed ? "bg-accent-soft text-accent border-accent/25 font-medium" : "text-muted hover:bg-hover hover:text-fg",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	)
}

export function Count({ children }: { readonly children: ReactNode }) {
	return <span className="num text-[11px] opacity-75">{children}</span>
}

export function IconButton({ className, children, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn(
				"text-muted hover:bg-hover hover:text-fg inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-colors duration-150 sm:size-8",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	)
}

export function TextButton({ className, children, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn(
				"text-muted hover:text-fg inline-flex h-11 items-center gap-1 rounded-md px-2 text-[13px] underline-offset-[3px] hover:underline sm:h-7",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	)
}

/** Freshness dot: quiet when fine, amber when the data is stale or the last run failed. */
export function StatusDot({ warn, className }: { readonly warn: boolean; readonly className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-block size-1.5 shrink-0 rounded-full",
				warn ? "bg-warn" : "bg-[oklch(0.68_0.06_152)] opacity-70",
				className,
			)}
		/>
	)
}
