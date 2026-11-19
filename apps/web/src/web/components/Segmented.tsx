import { cn } from "#/lib/utils"

/** A popover section choosing one of `options`, the chosen one filled amber. */
export function Segmented<Option extends string>({
	legend,
	options,
	value,
	onChange,
}: {
	readonly legend: string
	readonly options: ReadonlyArray<Option | { readonly id: Option; readonly label: string }>
	readonly value: Option
	readonly onChange: (option: Option) => void
}) {
	return (
		<fieldset className="border-rule border-b px-3.5 pt-2.5 pb-2">
			<legend className="text-warm float-left mb-1.5 w-full text-[11px] tracking-[0.14em]">{legend}</legend>
			<div className="border-rule clear-both flex border">
				{options.map((entry, i) => {
					const option = typeof entry === "string" ? entry : entry.id
					const on = value === option
					return (
						<button
							key={option}
							type="button"
							aria-pressed={on}
							onClick={() => onChange(option)}
							className={cn(
								"h-7 flex-1 text-[11px] tracking-[0.08em] uppercase",
								i > 0 && "border-l border-rule",
								on ? "bg-warm font-bold text-on-accent" : "text-dim hover:text-ink",
							)}
						>
							{typeof entry === "string" ? entry : entry.label}
						</button>
					)
				})}
			</div>
		</fieldset>
	)
}
