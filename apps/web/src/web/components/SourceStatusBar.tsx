import type { SnapshotRow, SourceStatus } from "@fundstats/shared/api"
import { SOURCES } from "@fundstats/shared/sources"
import { AlertTriangle } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Badge } from "#/components/ui/badge"

import { formatDateTime } from "../format.ts"

/** "Data as of" line, plus a visible warning when the source is stale or its last run failed. */
export function SourceStatusBar({
	status,
	rows,
}: {
	readonly status: SourceStatus
	readonly rows: ReadonlyArray<SnapshotRow>
}) {
	const info = SOURCES[status.id]
	const updated = status.lastSuccess?.finishedAt ?? status.lastSuccess?.startedAt
	// Funds carry their own valuation date; show the newest one.
	const asOf = rows.reduce<string | null>((max, row) => (row.asOf && (!max || row.asOf > max) ? row.asOf : max), null)
	const failed = status.lastRun?.status === "failed"

	return (
		<div className="space-y-3">
			<div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<span>
					Data as of <span className="text-foreground">{asOf ?? (updated ? formatDateTime(updated) : "never")}</span>
				</span>
				{asOf && updated ? <span>· collected {formatDateTime(updated)}</span> : null}
				<span>
					· Source:{" "}
					<a href={info.homepage} target="_blank" rel="noreferrer" className="underline underline-offset-4">
						{info.name}
					</a>{" "}
					({info.currency})
				</span>
				{status.stale ? <Badge variant="destructive">Stale</Badge> : null}
			</div>
			{failed || status.stale ? (
				<Alert variant="destructive">
					<AlertTriangle />
					<AlertTitle>
						{status.lastSuccess === null
							? `No data collected from ${info.name} yet`
							: failed
								? `The last update from ${info.name} failed`
								: `Data from ${info.name} is out of date`}
					</AlertTitle>
					<AlertDescription>
						{failed && status.lastRun?.error ? <p>{status.lastRun.error}</p> : null}
						<p>
							{status.lastSuccess
								? `Showing data from the last successful update (${formatDateTime(updated ?? status.lastSuccess.startedAt)}).`
								: "The collector will try again on its next run."}
						</p>
					</AlertDescription>
				</Alert>
			) : null}
		</div>
	)
}
