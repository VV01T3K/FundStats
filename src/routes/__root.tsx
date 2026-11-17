import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRouteWithContext, HeadContent, Link, Scripts } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import type { ReactNode } from "react"
import { TooltipProvider } from "#/components/ui/tooltip"
import { SourceNav } from "#/web/components/SourceNav.tsx"
import appCss from "../styles.css?url"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "FundStats" },
			{ name: "description", content: "Ranked returns of mBank investment funds and top cryptocurrencies." },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
		],
	}),
	shellComponent: RootDocument,
	notFoundComponent: () => (
		<div className="py-16 text-center">
			<p className="text-lg font-medium">Page not found</p>
			<Link to="/" className="mt-2 inline-block text-sm underline underline-offset-4">
				Back to the tables
			</Link>
		</div>
	),
})

function RootDocument({ children }: { children: ReactNode }) {
	return (
		// Dark theme by default.
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<TooltipProvider>
					<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-6">
						<header id="top" className="flex flex-wrap items-center justify-between gap-4">
							<Link to="/" className="text-xl font-semibold tracking-tight">
								FundStats
							</Link>
							<SourceNav />
						</header>
						<main className="flex-1">{children}</main>
						<footer className="text-xs text-muted-foreground">
							Data is collected periodically from public provider APIs and served from the FundStats database. Not
							investment advice.{" "}
							<a href="/api/docs" className="underline underline-offset-4">
								API
							</a>
						</footer>
					</div>
				</TooltipProvider>
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{ name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
							{ name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	)
}
