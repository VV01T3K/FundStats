import { Popover } from "@base-ui/react/popover"
import { Settings } from "lucide-react"

import { THEMES } from "../prefs.ts"
import { usePrefs } from "../PrefsContext.tsx"
import { Segmented } from "./Segmented.tsx"

/** The header's gear: app-wide settings (theme, SOON features), apart from any one table's. */
export function SettingsMenu() {
	const { prefs, update } = usePrefs()
	return (
		<Popover.Root>
			<Popover.Trigger
				aria-label="Settings"
				className="border-rule-strong text-dim hover:text-ink data-[popup-open]:border-warm data-[popup-open]:text-warm grid size-[26px] place-items-center border max-lg:size-11"
			>
				<Settings aria-hidden className="size-3.5" />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-40">
					<Popover.Popup className="popup border-rule-strong bg-panel text-ink w-64 border text-[11px] shadow-[0_12px_32px_rgb(0_0_0/0.5)] outline-none">
						<Popover.Title className="sr-only">Settings</Popover.Title>
						<Segmented
							legend="THEME"
							options={THEMES}
							value={prefs.theme}
							onChange={(theme) => update({ ...prefs, theme })}
						/>
						<Segmented
							legend="SOON FEATURES"
							options={["show", "hide"] as const}
							value={prefs.showSoon ? "show" : "hide"}
							onChange={(choice) => update({ ...prefs, showSoon: choice === "show" })}
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}
