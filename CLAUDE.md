# CLAUDE.md -- D3 Heatmap UI component

Context for Claude Code (or any agent) continuing work on this project.

## What this is

A ServiceNow **Next Experience / UI Builder** custom component that renders a
configurable matrix **heatmap** with D3 v7. It is a sibling of the **D3 Line
Chart** / **D3 Column Chart** components and mirrors their architecture and
conventions -- but its **data shape is different** (see Data contract below).

- Component tag: `x-2114311-heatmap-chart-uic` . Scope: `x_2114311_heat_0` (scopeName must be <= 18 chars)
- Vendor prefix `x_2114311` is shared with the line/column charts.
- CSS class prefix: `hc` (e.g. `.hc-root`, `.hc-svg`, `.hc-tooltip`, `.hc-cell`).

## Architecture (important conventions)

- **Seismic + D3 split.** The snabbdom `view` renders only a single stable
  `<div class="hc-root">`. D3 owns the SVG imperatively.
  `drawChart(container, props, dispatch)` in
  `src/x-2114311-heatmap-chart-uic/chart.js` fully re-renders on every property
  change. Never mix snabbdom virtual DOM with D3 mutation on the same nodes.
- **Lifecycle** (`index.js`): redraw on `COMPONENT_RENDERED` and
  `COMPONENT_PROPERTY_CHANGED`; a `ResizeObserver` (wired in
  `COMPONENT_DOM_READY`) redraws on width changes only, and skips re-animating so
  the fade-in isn't snapped to its end state. State is stashed on
  `host._hcLast` / `host._hcWidth` / `host._hcResizeObserver`.
- **D3 imports must be NAMED submodule imports** (`import { select } from
'd3-selection'`, `import { scaleBand, scaleSequential, scaleDiverging,
scaleQuantize } from 'd3-scale'`, `import { interpolateBlues, ... } from
'd3-scale-chromatic'`), not `import * as d3`. The ServiceNow prod build
  tree-shakes a passed-around namespace and would strip methods. Only the `d3`
  meta-package is a dependency; submodules resolve through it.
- **No `d3-transition`.** The fade/grow-in animation grows each cell from its
  center and fades opacity via `requestAnimationFrame`, with a diagonal per-cell
  stagger. Don't introduce `d3-transition` -- it gets tree-shaken out.
- **Indentation is TABS** in JS (see `.editorconfig`); ESLint uses
  `@tectonic/tectonic/servicenow`.
- **Server files are ES5** (`server/*.js`) -- scoped/global ServiceNow
  compatibility (no `let`/arrow funcs/template literals there).

## Files

- `src/x-2114311-heatmap-chart-uic/index.js` -- `createCustomElement`: property
  defaults + lifecycle. Note `hasData()` accepts both the flat-array and the
  explicit-order object form before falling back to `SAMPLE_DATA`.
- `src/x-2114311-heatmap-chart-uic/chart.js` -- the D3 renderer (the bulk of the
  logic): `normalizeData` (auto-detects array vs object form), color scale build
  (sequential/diverging/quantize + reverse + fixed domain), band scales, cells
  with missing-cell blanks, auto-contrast labels, color legend (right/bottom),
  tooltip, events, and the rAF animation.
- `src/x-2114311-heatmap-chart-uic/sampleData.js` -- `SAMPLE_DATA` (a flat cell
  array; a day x hour activity matrix).
- `src/x-2114311-heatmap-chart-uic/styles.scss` -- host/container/tooltip styles.
- `now-ui.json` -- UI Builder manifest: every property (section-prefixed labels) +
  the `CHART_CLICKED` / `CELL_CLICKED` / `CELL_HOVERED` actions. **Keep this in
  sync with the `properties` block in `index.js` and the prop reads in
  `chart.js`.** JSON-typed `data` default lives in `index.js`, NOT the manifest.
- `server/` -- platform-side sources (`D3MatrixData.js` Script Include + the
  Data Transform script + properties JSON + sanity-test background script +
  README). NOT shipped by `snc ui-component deploy`; created as platform records.
- `scripts/verify_chart.mjs` -- headless verification harness (47 scenarios).

## Data contract (DIFFERENT from line/column)

`data` = a **flat array of cells** `[ { x, y, value } ]` where `x` = column
category, `y` = row category, and `value` drives the cell **COLOR**. Missing
`(x,y)` pairs render as blank cells. An explicit-order object form is also
accepted and auto-detected: `{ xCategories, yCategories, cells: [...] }`.

This contrasts with the line/column charts' `series` array of
`{ name, color, data: [ { label, value } ] }`, where color = series identity and
`value` = a bar height / line position. The heatmap server Script Include is
**`D3MatrixData`** (groups by TWO fields: `xField` AND `yField`), separate from
the line/column `D3ChartData` (groups by one).

## Build / dev / deploy

```bash
npm install
snc ui-component develop --open          # local hot-reload harness (example/element.js)
snc ui-component generate-update-set --offline
snc ui-component deploy                   # push to the connected instance
```

Requires the `snc` CLI + a configured profile. The CLI needs a real instance.

## How to verify changes without an instance

```bash
node scripts/verify_chart.mjs --chart src/x-2114311-heatmap-chart-uic/chart.js
```

Bundles `chart.js` with real d3 (esbuild) and runs `drawChart` in jsdom across a
property matrix, asserting an `<svg>` with no exceptions. Server logic: load
`server/D3MatrixData.js` with `Class = { create: () => function(){} }` stubbed
and exercise `fromRows(...)` (pure JS; `fromAggregate` needs Glide). All 47
scenarios passed during the build.

## If adding a property

Update all three places: `now-ui.json` (manifest), `index.js` (default), and the
read in `chart.js`. Add a scenario to `scripts/verify_chart.mjs`.
