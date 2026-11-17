import { Link } from "@tanstack/react-router"

import { cn } from "#/lib/utils"
import { KIND_SEGMENT, SOURCE_IDS, SOURCES } from "#/shared/sources.ts"

/** The brand-icon buttons that switch between sources, as on the old site. */
export function SourceNav() {
	return (
		<nav aria-label="Data sources" className="flex flex-wrap gap-2">
			{SOURCE_IDS.map((id) => {
				const info = SOURCES[id]
				return (
					<Link
						key={id}
						to="/$kind/$source"
						params={{ kind: KIND_SEGMENT[info.kind], source: id }}
						className={cn(
							"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
						)}
						activeProps={{ className: "border-primary bg-accent" }}
						aria-label={`${info.name} table`}
					>
						<img src={info.icon} alt="" width={24} height={24} className="size-6" />
						<span className="hidden sm:inline">{info.name}</span>
					</Link>
				)
			})}
		</nav>
	)
}
