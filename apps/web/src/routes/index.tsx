import { createFileRoute, redirect } from "@tanstack/react-router"

// The mBank equity-fund table was the old site's landing view.
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/$kind/$source", params: { kind: "funds", source: "mbank" } })
	},
})
