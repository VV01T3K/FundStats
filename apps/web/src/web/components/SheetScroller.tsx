import { type ReactNode, type UIEvent, useLayoutEffect, useRef, useState } from "react"

/**
 * The sheet's scroll area. On phones columns snap to their left edge after the sticky names, and a
 * fade marks the trailing edge while more columns lie beyond it, so a figure cut mid-glyph reads as
 * cut rather than as a shorter number.
 */
interface Edge {
	readonly more: boolean
	readonly scrollbar: number
}

const readEdge = (element: HTMLElement, current: Edge): Edge => {
	const more = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
	const scrollbar = element.offsetWidth - element.clientWidth
	return current.more === more && current.scrollbar === scrollbar ? current : { more, scrollbar }
}

export function SheetScroller({ id, children }: { readonly id: string; readonly children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null)
	const [edge, setEdge] = useState<Edge>({ more: false, scrollbar: 0 })

	useLayoutEffect(() => {
		const element = ref.current
		if (!element) return
		setEdge((current) => readEdge(element, current))
		const observer = new ResizeObserver(() => setEdge((current) => readEdge(element, current)))
		observer.observe(element)
		if (element.firstElementChild) observer.observe(element.firstElementChild)
		return () => observer.disconnect()
	}, [])

	return (
		<div className="relative min-h-0 flex-1 border-t">
			<div
				ref={ref}
				onScroll={(event: UIEvent<HTMLDivElement>) => {
					const element = event.currentTarget
					setEdge((current) => readEdge(element, current))
				}}
				// Positioned, so absolutely placed content (screen-reader text) is clipped here, not by the page.
				className="relative h-full overflow-auto max-sm:snap-x max-sm:snap-proximity max-sm:scroll-pl-[12.75rem]"
				data-scroll-restoration-id={id}
			>
				{children}
			</div>
			{edge.more ? (
				<div
					aria-hidden
					className="from-bg pointer-events-none absolute inset-y-0 w-8 bg-gradient-to-l to-transparent"
					style={{ right: edge.scrollbar }}
				/>
			) : null}
		</div>
	)
}
