import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import type { ReactNode } from "react"

import { DEFAULT_PREFS, themeColor } from "#/web/prefs.ts"
import { loadPrefs, PrefsProvider } from "#/web/PrefsContext.tsx"

import appCss from "../styles.css?url"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	head: ({ loaderData }) => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
			{ name: "theme-color", content: themeColor(loaderData?.theme ?? DEFAULT_PREFS.theme) },
			{ title: "FundStats" },
			{ name: "description", content: "Ranked returns of mBank investment funds and top cryptocurrencies." },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
		],
	}),
	loader: () => loadPrefs(),
	// The cookie changes only through PrefsProvider, which keeps its own state; never reload it.
	staleTime: Infinity,
	shellComponent: RootDocument,
	component: RootLayout,
	notFoundComponent: NotFound,
})

function RootLayout() {
	const prefs = Route.useLoaderData()
	return (
		<PrefsProvider initial={prefs}>
			<Outlet />
		</PrefsProvider>
	)
}

function NotFound() {
	return (
		<main className="bg-bg grid min-h-dvh place-items-center p-6 text-center">
			<div>
				<p className="text-warm text-[32px]" aria-hidden>
					404
				</p>
				<h1 className="mt-2 text-[13px] font-semibold tracking-[0.04em]">Page not found</h1>
				<p className="text-dim mt-1 text-[11px]">This link points to no table or instrument.</p>
				<Link
					to="/"
					className="border-rule-strong text-ink hover:border-warm hover:text-warm mt-5 inline-block border px-3 py-1.5 text-[11px] tracking-[0.06em]"
				>
					BACK TO THE TABLES
				</Link>
			</div>
		</main>
	)
}

function RootDocument({ children }: { children: ReactNode }) {
	// The server renders the viewer's theme from the cookie; PrefsProvider switches it in the browser.
	const prefs = Route.useLoaderData()
	return (
		<html lang="en" data-theme={prefs.theme}>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
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
