import { useId } from "react"

/** "Fun" + the D|S monogram + "tats", the terminal (mono) cut of the owner's wordmark. */
export function Wordmark({ size = 20 }: { readonly size?: number }) {
	const mask = useId()
	return (
		<span
			role="img"
			aria-label="FundStats"
			className="text-ink inline-flex items-center font-bold"
			style={{ gap: size * 0.04, fontSize: size, lineHeight: 1, letterSpacing: "-0.01em" }}
		>
			<span aria-hidden>Fun</span>
			<svg viewBox="0 0 64 64" width={size * 1.05} height={size} aria-hidden className="block shrink-0">
				<defs>
					<mask id={mask}>
						<rect width="64" height="64" fill="white" />
						<rect x="36" y="29" width="16" height="7" fill="black" />
					</mask>
				</defs>
				<g mask={`url("#${mask}")`}>
					<path
						d="M 8 6 L 30 6 L 50 18 L 50 46 L 30 58 L 8 58 Z M 16 14 L 16 50 L 28 50 L 42 42 L 42 22 L 28 14 Z"
						fill="currentColor"
						fillRule="evenodd"
					/>
				</g>
				<path
					d="M 50 16 L 36 16 L 22 26 L 36 34 L 50 34 L 50 46 L 32 50 L 22 46"
					fill="none"
					stroke="var(--warm)"
					strokeWidth="6"
					strokeLinejoin="miter"
					strokeLinecap="square"
				/>
			</svg>
			<span aria-hidden>tats</span>
		</span>
	)
}
