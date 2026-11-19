/** The FundStats mark: three rising bars, the brightest last. Also the favicon (public/favicon.svg). */
function LogoMark({ size }: { readonly size: number }) {
	return (
		<svg viewBox="0 0 20 20" width={size} height={size} aria-hidden className="block shrink-0">
			<rect x="1" y="11" width="4" height="8" fill="var(--warm)" opacity="0.55" />
			<rect x="8" y="7" width="4" height="12" fill="var(--warm)" opacity="0.8" />
			<rect x="15" y="1" width="4" height="18" fill="var(--warm)" />
		</svg>
	)
}

/** The logo: the mark, then "Fund" in ink and "Stats" in amber, in the terminal's mono face. */
export function Wordmark({ size = 20 }: { readonly size?: number }) {
	return (
		<span
			role="img"
			aria-label="FundStats"
			className="text-ink inline-flex items-center font-bold"
			style={{ gap: size * 0.4, fontSize: size, lineHeight: 1, letterSpacing: "-0.01em" }}
		>
			<LogoMark size={size * 0.9} />
			<span aria-hidden>
				Fund<span className="text-warm">Stats</span>
			</span>
		</span>
	)
}
