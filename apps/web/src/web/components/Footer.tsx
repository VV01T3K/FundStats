import { SOURCES, type SourceId } from "@fundstats/shared/sources"

import { cn } from "#/lib/utils"

import { formatCapturedFull } from "../format.ts"

export function Footer({
	source,
	collected,
	className,
}: {
	readonly source: SourceId
	readonly collected: string | null
	readonly className?: string
}) {
	const info = SOURCES[source]
	return (
		<footer className={cn("text-muted py-5 text-xs leading-relaxed", className)}>
			Dane z publicznego API{" "}
			<a href={info.homepage} target="_blank" rel="noreferrer" className="hover:text-fg underline">
				{info.name}
			</a>
			{collected ? `, pobrane ${formatCapturedFull(collected)}` : ""}, w {info.currency}. To nie jest porada
			inwestycyjna.
		</footer>
	)
}
