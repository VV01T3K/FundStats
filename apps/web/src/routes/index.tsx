import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/$kind/$source", params: { kind: "funds", source: "mbank" } })
	},
})
