---
name: FundStats
description: A dark trading-terminal view of Polish funds and crypto markets.
colors:
  bg: "#0a0b0c"
  outer: "#050608"
  panel: "#0e1012"
  panel-2: "#11151a"
  rule: "#1c1f23"
  rule-strong: "#2a3038"
  rule-hover: "#3a4048"
  ink: "#d9dde2"
  ink-dim: "#a8aeb6"
  dim: "#7d858e"
  warm: "#f7b955"
  cool: "#54a0ff"
  up: "#2ee07a"
  down: "#ff5a5f"
  on-accent: "#000000"
typography:
  display:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "32px"
    fontWeight: 400
  figure-lg:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "28px"
    fontWeight: 400
    fontFeature: "tnum"
  figure:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "26px"
    fontWeight: 400
    fontFeature: "tnum"
  headline:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "20px"
    fontWeight: 700
  figure-sm:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 400
    fontFeature: "tnum"
  title:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.04em"
  body:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "tnum"
  label:
    fontFamily: "JetBrains Mono Variable, ui-monospace, IBM Plex Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.1em"
rounded:
  none: "0"
spacing:
  xs: "4px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  xxl: "22px"
components:
  chip:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.dim}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "26px"
    typography: "{typography.label}"
  chip-active:
    backgroundColor: "{colors.warm}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "26px"
  input-search:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 36px"
    height: "32px"
    typography: "{typography.body}"
  source-tab:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.none}"
    padding: "14px 22px 11px"
    typography: "{typography.title}"
  source-tab-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "14px 22px 11px"
  table-header:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.dim}"
    rounded: "{rounded.none}"
    padding: "7px 14px 7px 8px"
    typography: "{typography.label}"
  type-tag:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.warm}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
    typography: "{typography.label}"
  popover:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    width: "240px"
---

# Design System: FundStats

## Overview

**Creative North Star: "The Trader Terminal"**

FundStats looks like a market data terminal: near-black, square, monospace and dense. Every screen is a full-width data surface first. Chrome is thin hairline rules and small uppercase labels, so the numbers carry the page. Amber is the single voice of the interface (selection, focus, the active source, the sorted column); green and red belong only to price movement.

Space is spent on data. There are no docked sidebars, no empty gutters beside the table and no decorative cards. Navigation lives in a drawer behind the menu button, closed by default, and the table runs edge to edge (or, by the viewer's choice, as one floating panel inset on the darker frame). Highlighted numbers change colour or weight, never position, so columns stay aligned.

The Terminal theme above is the default and the reference. Viewers can switch theme in the drawer (Display → Theme): every theme is the same token set with other values (styles.css, `<html data-theme>`), so components never name a colour.

- **Terminal** (default): this document's palette.
- **Classic**: the first FundStats's look (shadcn's dark zinc): zinc greys, violet-400 (#a78bfa) as the accent, blue-600 (#2563eb) row highlights, green-400 (#4ade80) and #ff2424 for moves. Colours only: the type stays the terminal's mono.
- **Light**: the terminal on paper: white surfaces, amber-700 (#b45309) accent, #03664a and #b91c1c for moves; every text colour holds 4.5:1 on white and on the highlight tint.

**Key Characteristics:**

- One monospace family, 11px at the smallest, tabular figures everywhere.
- Square corners on every element; hairline 1px rules instead of shadows for structure.
- Amber for interface state, green and red only for gains and losses.
- Full-width table; navigation in a drawer, never a docked column.

## Colors

A near-black neutral ladder with one warm accent and a strict up/down pair.

### Primary

- **Terminal Amber** (warm): the interface's only accent. The active source tab's underline and dot, the selected category chip (filled, black text), the sorted column header, the focus ring, the text caret and type tags. Freshness is not decorated: only a stale source gets a word (STALE, in Loss Red).

### Secondary

- **Signal Blue** (cool): rare informational accents only; never competes with amber for state.

### Tertiary

- **Gain Green** (up): positive returns and rising sparklines. Nothing else.
- **Loss Red** (down): negative returns and falling sparklines. Nothing else.

### Neutral

- **Terminal Black** (bg): the page and table background.
- **Void** (outer): the frame outside the app surface.
- **Panel Graphite** (panel): sticky table header, active source tab, popovers, tooltips.
- **Raised Graphite** (panel-2): a second layer inside panels.
- **Hairline** (rule): row dividers, section borders, quiet chip borders.
- **Strong Hairline** (rule-strong): input and chip borders, the header's bottom rule, scrollbar thumb.
- **Hover Hairline** (rule-hover): the scrollbar thumb under the pointer.
- **Paper Ink** (ink): primary text and figures.
- **Muted Ink** (ink-dim): secondary text such as inactive tab titles and long names.
- **Dim Label** (dim): labels, column headers, placeholders, counters. Lifted from the design's #6a727b so 11px text passes 4.5:1 on Terminal Black.

### Named Rules

**The One Voice Rule.** Amber marks interface state and nothing else. If two amber things compete on screen, one of them is wrong.

**The Money Colour Rule.** Green and red mean up and down. Never use them for status, success, error or decoration.

## Typography

**Body Font:** JetBrains Mono Variable (with ui-monospace, IBM Plex Mono, Menlo)

**Character:** A single monospace face at every role. Hierarchy comes from size, weight, case and tracking, never from a second family.

### Hierarchy

- **Display** (400, 32px): the empty-table glyph.
- **Figure large / Figure** (400, 28px / 26px, tabular): an instrument's price; the summary figures above a table.
- **Headline** (700, 20px): an instrument page's name.
- **Figure small** (400, 14px, tabular): the returns beside an instrument's chart.
- **Title** (700, 13px, tracking 0.04em): source tab names and section titles. Inactive tabs drop to 500 in Muted Ink.
- **Body** (400, 12px, tabular figures): table cells and running text, such as a fund's long name.
- **Label** (400, 11px, tracking 0.06–0.14em, often uppercase): column headers, chips, type tags, compact table density, keyboard hints, SOON marks.

**The 11px Floor Rule.** No text is smaller than 11px, labels included; running text is at least 12px.

### Named Rules

**The Aligned Figures Rule.** Every number uses tabular figures and right alignment. Emphasis changes colour or weight only, so a highlighted value never shifts its column.

## Layout

A vertical stack, full width: header (menu, wordmark, search across every source, "Updated" time in Polish format, sign-in), source tabs (four equal columns on desktop, a scrollable pill strip below 1024px), a controls bar (category chips, row count, table settings), then the table filling the rest of the viewport, then a thin status footer.

The table is a size container (`market`). Below 1100px of table width it drops descriptive columns; below 52rem it keeps only identity, price and the sorted column. Columns respond to the space the table has, not the viewport.

Spacing is tight and irregular in the terminal tradition: 4, 8, 10, 14, 18 and 22px are the working steps. Touch targets grow to 44px on small screens (chips and header buttons switch to `h-11`).

### Named Rules

**The No Gutter Rule.** The table spans the full width. Don't add sidebars, empty columns or centred max-width containers beside it. Inside it, spare width is spread over the figure columns; the name column stops at its longest name (at most 44ch), so no single gap opens after the names.

**The Floating Option.** The viewer can switch the table to a floating panel (LAYOUT in the table settings): an inset of 32px × 24px on Void with a Strong Hairline border, on screens 1024px and up. It is a frame around the full-width table, not a narrower one.

## Elevation & Depth

Flat by default. Structure comes from 1px hairlines and the step from Terminal Black to Panel Graphite. Shadows appear only on things floating above the table: popovers (`0 12px 32px rgb(0 0 0 / 0.5)`), the menu drawer (`8px 0 32px rgb(0 0 0 / 0.6)`) and chart tooltips (`0 8px 24px rgb(0 0 0 / 0.5)`).

### Named Rules

**The Float-Only Shadow Rule.** A shadow means "this is above the table". Nothing resting on the page carries one.

## Shapes

Square everywhere: radius 0 on buttons, chips, inputs, popovers, tags and scrollbars. The only round shape is the small status dot in the mobile source strip. Borders are 1px; the active source tab gets a 3px amber underline.

## Components

### Chips

- **Style:** 26px tall, 1px Strong Hairline border, Dim Label text, 11px uppercase with 0.06em tracking.
- **State:** the selected chip fills with Terminal Amber and switches to bold black text. Hover lifts the text to Paper Ink.

### Source tabs

- **Style:** four equal cells divided by hairlines. Each has the provider's own logo (16px; dimmed when inactive), a 13px title and an 11px Dim Label tagline listing timeframes.
- **State:** the active tab gets Panel Graphite fill and a 3px amber underline; a stale source adds a red STALE badge. On mobile the tabs become a scrolling strip of logo and name.

### Inputs / Fields

- **Style:** 32px search field on Terminal Black, 1px Strong Hairline border, search icon at left and a boxed `/` shortcut hint at right.
- **Focus:** the border turns amber; the caret is amber.

### Market table (signature)

- Sticky header row in Panel Graphite, 11px uppercase labels in Dim Label; the sorted column's label and arrow turn amber.
- Rows are separated by hairlines. Figures are right-aligned and coloured by sign. A sparkline sits in the last column with a 1px non-scaling stroke in the row's up or down colour.
- Keyboard focus outlines the whole row in amber, not the link text.
- The type tag is a small bordered amber label (for example "AKCYJNY").

### Popovers

- Panel Graphite, Strong Hairline border, square, float shadow. Sections are split by hairlines with amber 10px legends (DENSITY, COLUMNS). They enter 4px above their final place over 140ms.

### Navigation drawer

- A native modal dialog sliding in from the left (260ms, `cubic-bezier(0.22, 1, 0.36, 1)`), at most 340px wide, over a 55% black backdrop. Closed by default.

### Source options (drawer)
- The drawer's first section after Source status holds options only the open source has, kept in the URL like the bar's: funds filter by risk level (toggle chips of mBank's own scale) and fund family (a select); crypto filter by a market-cap floor (ANY, 100M, 1B, 10B) and can pin the column the highlight reads (AUTO follows the sort).
- While any of them is on, the controls bar shows an amber "N FILTERS ×" chip that clears them.

### Highlight slider
- The crypto bar's threshold is a slider that stops only at the source's presets (OFF, 10–50%; CoinPaprika also 5%), each marked with a tick and labelled under the track; the chosen label is amber and bold.

### Settings (header gear)
- App-wide settings live behind the gear in the header, not in the drawer: Theme and SOON features.

## Do's and Don'ts

### Do:

- **Do** keep every corner square (radius 0).
- **Do** use Terminal Amber for exactly one meaning: interface state (active, selected, sorted, focused).
- **Do** right-align numbers with tabular figures and signal direction with Gain Green and Loss Red only.
- **Do** give the table the full width and move navigation into the drawer.
- **Do** keep labels at 11px uppercase with letter spacing, in Dim Label; never smaller.

### Don't:

- **Don't** dock a sidebar or leave empty space beside the table.
- **Don't** shift a number's position to highlight it; change colour or weight instead.
- **Don't** use green or red for anything except price movement.
- **Don't** introduce a second font family or rounded corners.
- **Don't** put shadows on elements that rest on the page.
