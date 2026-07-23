# Burnlist Terminal UI

This is a private build package for the interactive Burnlist observer. It does
not add runtime dependencies to the Node CLI or dashboard server. `bun build
--compile` emits a standalone executable under `tui/dist/`.

## Architecture

The terminal app has four explicit boundaries:

1. `.glyph` files declare screens and compose a fixed component registry. They
   are data, not executable plugins.
2. The data client reads the dashboard's existing `/api/projects`,
   `/api/burnlists`, `/api/ovens`, `/api/ovens/:id`, `/api/progress`, and
   `/api/oven-data` endpoints without mutating canonical state.
3. OpenTUI React owns layout, focus, keyboard input, and terminal painting.
4. glyphcss owns mesh rasterization and spatial effects. Visual Parity PNGs use
   a custom OpenTUI renderable backed by its native 2×2 RGBA supersampler, which
   preserves four color samples in every terminal cell with quadrant blocks.

The TypeScript aliases in `tsconfig.json` prefer the glyphcss packages from
`../../../glyphcss`, which is the same checkout as `../../glyphcss` from the
Burnlist repository root. A clean checkout without that sibling falls back to
the exact registry versions in `devDependencies`, keeping CI and standalone
builds reproducible. The root Burnlist package keeps an empty runtime dependency
set.

## Commands

```sh
npm install
npm run dev -- --server http://127.0.0.1:4510
npm run verify
```

The landing screen follows the web dashboard with one relaxed, full-width
Burnlist list whose columns adapt to terminal width. Up/down selects a row and
`enter` opens it. `o` opens a separate catalog containing only global generic
Ovens; `enter` there inspects an Oven's contract, declared components,
instructions, and revision rather than resolving a repository installation.

Burnlist detail places its summary and animated glyphcss fire beside the active
Oven on wide terminals and stacks them on narrow ones. Its active and completed
items are keyboard-navigable, the newest completion is marked `LATEST`, and
`enter` opens the selected item's fields or completion detail. Visual Parity
frame items render reference, candidate, and diff PNGs at 2× horizontal and 2×
vertical sample density; left and right change render domains. `[` and `]`
cycle contract-compatible Oven lenses.

`q` always goes back. `escape` also goes back from nested views and is the only
in-app exit key when pressed on the main landing page. `r` refreshes. The base
surface is transparent and separator colors are derived from the terminal's
reported palette, so VS Code and other hosts supply their own background.
