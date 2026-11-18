import { createFileRoute, redirect } from "@tanstack/react-router"

/** The fund table, sorted by momentum (its default view). */
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/$kind/$source", params: { kind: "funds", source: "mbank" } })
	},
})
