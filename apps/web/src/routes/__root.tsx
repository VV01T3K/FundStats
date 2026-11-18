import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRouteWithContext, HeadContent, Link, Scripts } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import type { ReactNode } from "react"

import { TooltipProvider } from "#/components/ui/tooltip"
import { sourcesQuery } from "#/web/api.ts"
import { AppHeader, themeScript } from "#/web/components/AppHeader.tsx"

import appCss from "../styles.css?url"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "FundStats" },
			{ name: "description", content: "Stopy zwrotu funduszy mBank i największych kryptowalut, w jednej tabeli." },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
		],
	}),
	// The header's freshness dots; a failure here must not take the page down, so prefetch only.
	loader: ({ context }) => context.queryClient.prefetchQuery(sourcesQuery()),
	shellComponent: RootDocument,
	notFoundComponent: () => (
		<div className="mx-auto max-w-[1600px] px-4 py-16">
			<p className="text-[15px] font-medium">Nie ma takiej strony.</p>
			<Link to="/" className="text-accent mt-2 inline-block text-[13px] underline">
				Wróć do tabeli funduszy
			</Link>
		</div>
	),
})

function RootDocument({ children }: { children: ReactNode }) {
	return (
		// The theme script may set data-theme before React hydrates.
		<html lang="pl" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				<HeadContent />
			</head>
			<body>
				<TooltipProvider delayDuration={300}>
					<AppHeader />
					{children}
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
