# D3 Heatmap -- UI Builder custom component

A configurable matrix **heatmap** for ServiceNow UI Builder, rendered with
[D3.js](https://d3js.org/). A grid of cells indexed by an X category (columns)
and a Y category (rows); each cell is colored by its numeric `value` via a
sequential / diverging / quantized color scale. The entire look-and-feel is
driven by component properties, so page builders can restyle it from the UI
Builder property panel without touching code. It supports a gradient color
legend, optional auto-contrast in-cell value labels, column/row sorting, square
cells, and emits events you can hook (click the chart, click/hover a cell to
drill in).

- **Component tag:** `x-2114311-heatmap-chart-uic`
- **Scope:** `x_2114311_heat_0`
- **Renderer:** Seismic (`@servicenow/ui-renderer-snabbdom`) + D3 v7

> **Sibling of the D3 Line / Column charts.** This component shares their vendor
> prefix (`x_2114311`) and architecture, but its **data shape is different** --
> see [Data shape -- how it differs from the line/column chart](#data-shape----how-it-differs-from-the-linecolumn-chart).

---

## Project layout

```
src/x-2114311-heatmap-chart-uic/
|-- index.js        # createCustomElement: properties, view (stable container), lifecycle handlers
|-- chart.js        # drawChart(container, props, dispatch) -- the D3 rendering
|-- sampleData.js   # SAMPLE_DATA fallback so it renders on drop
|-- styles.scss     # host + container sizing, tooltip, hover/focus affordances
`-- __tests__/
now-ui.json         # UI Builder manifest: properties + actions exposed to authors
now-cli.json        # CLI build config
package.json        # deps incl. d3
scripts/verify_chart.mjs  # headless verification harness
server/             # platform-side Script Include + Data Transform sources (see below)
```

D3 owns the SVG imperatively. The Seismic view renders only a single `.hc-root`
div; the chart is (re)drawn from the `COMPONENT_RENDERED` / `COMPONENT_DOM_READY`
lifecycle actions, and a `ResizeObserver` redraws it when the UI Builder slot
resizes. This keeps snabbdom's virtual DOM and D3's direct DOM mutation on
separate elements.

---

## Develop & deploy

> Requires the `snc` CLI with the `ui-component` extension and a configured
> connection profile.

```powershell
# One-time: install the CLI and point it at your instance
npm install -g @servicenow/cli
snc configure profile set            # enter instance URL + credentials

# Install JS deps for this project
npm install

# Local dev harness (hot-reloading), opens example/element.js
snc ui-component develop --open

# Build the deployable update set XML without contacting the instance
snc ui-component generate-update-set --offline

# Build and push the component to the connected instance
snc ui-component deploy
```

After deploying, open **UI Builder -> add component -> "D3 Heatmap"** (category
_Primitives_). Bind `data` to a data resource (or leave it empty to show sample
data), tune the look-and-feel in the property panel, and wire the events under
the component's **Events** section.

---

## Data shape -- how it differs from the line/column chart

This is the important difference. **The line and column charts** take a `series`
array: one named, colored entry per line/bar group, each with `{ label, value }`
points. There the x-axis is categorical, the y-axis is the value, and **color
encodes series identity**:

```jsonc
// line / column chart  --  series array (NOT what the heatmap uses)
[
  {
    "name": "Submitted",
    "color": "#2E93fA",
    "data": [
      { "label": "Jan", "value": 44 },
      { "label": "Feb", "value": 55 },
    ],
  },
  {
    "name": "Resolved",
    "color": "#66DA26",
    "data": [
      { "label": "Jan", "value": 35 },
      { "label": "Feb", "value": 41 },
    ],
  },
]
```

**The heatmap** takes a **flat array of cells**. Each cell is `{ x, y, value }`
where **both `x` and `y` are categorical axes** (columns and rows) and the
numeric **`value` is mapped to the cell's COLOR** via a color scale -- not to a
bar height or a line position. There is no `series` and no per-series color:

```jsonc
// heatmap  --  flat cells; value -> COLOR
[
  { "x": "Mon", "y": "9am", "value": 12 },
  { "x": "Tue", "y": "9am", "value": 7 },
  { "x": "Mon", "y": "12pm", "value": 30 },
  { "x": "Tue", "y": "12pm", "value": 27 },
]
```

|                     | Line / Column chart        | Heatmap                    |
| ------------------- | -------------------------- | -------------------------- |
| Data property       | `series`                   | `data`                     |
| Top-level shape     | array of series objects    | flat array of cells        |
| Point/cell shape    | `{ label, value }`         | `{ x, y, value }`          |
| X axis              | categorical (`label`)      | categorical (`x` = column) |
| Y axis              | the value                  | categorical (`y` = row)    |
| What `value` drives | bar height / line position | **cell color**             |
| What color encodes  | series identity            | **the value**              |

Missing `(x, y)` combinations render as blank cells (the **Missing-cell color**).
Column and row order is first-seen by default; the `Column sort` / `Row sort`
properties can reorder by label or by total value.

### Optional explicit-order object form

Instead of a bare array you may pass an object that also fixes the column/row
order (handy when you want a specific axis ordering regardless of data order).
The component **auto-detects** the form: an `Array` is treated as cells; an
object with a `cells` array is treated as the explicit-order form.

```jsonc
{
  "xCategories": ["Q1", "Q2", "Q3", "Q4"],
  "yCategories": ["North", "South", "East", "West"],
  "cells": [
    { "x": "Q1", "y": "North", "value": 10 },
    { "x": "Q2", "y": "North", "value": 22 },
    { "x": "Q3", "y": "East", "value": 31 },
  ],
}
```

Leave `data` empty/unbound to render built-in sample data (a day x hour activity
matrix).

---

## Feeding data from the platform (Data Transform)

You rarely want to hand-write `data`. The recommended pattern turns real table
data into the cells JSON **on the server** and binds it straight to _Data .
Cells_. All transform logic lives in a reusable **Script Include**
(`server/D3MatrixData.js`); a **Transform data resource** calls it and exposes
its output to UI Builder.

```
Table --GlideAggregate (group by xField AND yField)--> D3MatrixData --cells JSON--> Transform data resource
                                                                                          | @data.<name>.output
                                                                                          v
                                                                                  Data . Cells
```

> **The Script Include groups by TWO fields.** Where the line/column chart's
> `D3ChartData` groups by one category field to make a `series` array, the
> heatmap's `D3MatrixData` groups by an **xField and a yField** to make a flat
> `[ { x, y, value } ]` array. They're separate Script Includes; both can live
> on the same instance.

Server-side source files live in **`server/`**:

| File                                     | What it is                                          |
| ---------------------------------------- | --------------------------------------------------- |
| `server/D3MatrixData.js`                 | Script Include -- `fromAggregate()`, `fromRows()`   |
| `server/d3-heatmap-data.transform.js`    | Data resource script (delegates to `fromAggregate`) |
| `server/d3-heatmap-data.properties.json` | Data resource inputs (bare JSON array)              |
| `server/sanity-test.background.js`       | Verify the transforms; log the cell JSON            |
| `server/README.md`                       | Full setup incl. the execute-ACL steps              |

### Setup (one time)

1. **Create the Script Include.** _System Definition -> Script Includes -> New_.
   Name it `D3MatrixData`, **Accessible from = All application scopes**,
   **Client callable = false**, paste `server/D3MatrixData.js`. Save.
2. **Create the Transform data resource.** UI Builder: **Add data resource ->
   Transform** (a `sys_ux_data_broker_transform` record). Name it e.g.
   `D3 Heatmap Data`, leave **Mutates server data** unchecked, paste
   `server/d3-heatmap-data.transform.js` into **Script**, and paste the **bare
   JSON array** from `server/d3-heatmap-data.properties.json` into **Properties**.
3. **Create the execute ACL** (required -- the resource won't run without it):
   get the data broker's **sys_id**, **Elevate role -> security_admin**, then
   **System Security -> Access Control (ACL) -> New**: **Type** = `ux_data_broker`,
   **Operation** = `execute`, **Name** = the data broker **sys_id** (padlock to
   free text), **Active** = true, plus one permissive criterion (e.g.
   **`UserIsAuthenticated`**). **Submit**, reload UI Builder. Full details in
   `server/README.md`.

### Use it: aggregate a table

- **Bind:** _Data . Cells_ -> `@data.d3_heatmap_data.output` (your resource name).
- **Example -- incidents by priority (columns) x state (rows), count:**
  `table` = `incident`, `xField` = `priority`, `yField` = `state`,
  `metric` = `count`, `useDisplayValue` = true. -> a priority x state grid where
  color = the incident count.
- **Example -- avg reassignments by group x category:** `xField` =
  `assignment_group`, `yField` = `category`, `metric` = `avg`, `valueField` =
  `reassignment_count`.

`fromAggregate(cfg)` inputs: `table`, `filter`, `xField`, `yField`, `metric`
(`count`/`sum`/`avg`/`min`/`max`), `valueField`, `useDisplayValue`. (Optional
`sortX`/`sortY` pre-order the categories server-side.)

### Use it: reshape rows you already have

```js
function transform(input) {
  return new global.D3MatrixData().fromRows(input.rows, {
    xField: "day",
    yField: "hour",
    valueField: "hits",
    metric: "sum",
  });
}
```

### Verify

Run `server/sanity-test.background.js` in _Scripts - Background_ (Global scope)
to log the cell JSON before wiring it in.

> **Note:** these are **platform records** (Script Include / data resource /
> ACL), not part of the bundle `snc ui-component deploy` ships. The `server/`
> files are the version-controlled source.

---

## Configure properties

Panel labels are **prefixed by section** (`Cells . ...`, `Colors . ...`, etc.) to
mimic the native Data Visualization layout.

> **D3 format specifiers** -- several properties accept a
> [d3-format](https://github.com/d3/d3-format#locale_format) number string
> (`.0f`, `,.0f`, `$,.0f`, `.0%`, `.2s`).

### Data

| Property | `name` | Default         | Description                                                                                                                                                              |
| -------- | ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cells    | `data` | built-in sample | Flat array of `{ x, y, value }` cells, or the explicit-order object form `{ xCategories, yCategories, cells }`. Bind to a data resource or edit inline. Empty -> sample. |

### Header & border

| Property         | `name`             | Default                  |
| ---------------- | ------------------ | ------------------------ |
| Title            | `chartTitle`       | `Activity by Day & Hour` |
| Title font size  | `titleFontSize`    | `18`                     |
| Title color      | `titleColor`       | `#374151`                |
| Width            | `componentWidth`   | `50%`                    |
| Padding          | `componentPadding` | `12px`                   |
| Background color | `backgroundColor`  | `transparent`            |
| Border color     | `borderColor`      | blank                    |
| Border width     | `borderWidth`      | `0`                      |
| Border radius    | `borderRadius`     | `0`                      |

### Display

| Property                | `name`                       | Default                  | Description                                                                            |
| ----------------------- | ---------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Chart height (px)       | `chartHeight`                | `360`                    | Ignored when Cell aspect is Square.                                                    |
| Base font family        | `fontFamily`                 | blank                    | Inherit from the page when blank.                                                      |
| Drop shadow             | `dropShadow`                 | `false`                  | Soft drop shadow on the cells.                                                         |
| Shadow color / blur     | `shadowColor` / `shadowBlur` | `rgba(0,0,0,0.25)` / `4` | When drop shadow on.                                                                   |
| Hover highlight         | `hoverHighlight`             | `true`                   | Outline the hovered cell.                                                              |
| Animate                 | `animate`                    | `true`                   | Fade/grow cells in on first render and data change.                                    |
| Animation duration (ms) | `animationDuration`          | `800`                    |                                                                                        |
| Animation easing        | `animationEasing`            | `Cubic out`              | Linear, Cubic out, Cubic in-out, Quad out, Exp out, Back out, Bounce out, Elastic out. |
| Animation stagger (ms)  | `animationStagger`           | `6`                      | Per-cell diagonal cascade delay.                                                       |

### Cells

| Property           | `name`             | Default   | Description                                                                   |
| ------------------ | ------------------ | --------- | ----------------------------------------------------------------------------- |
| Cell gap (px)      | `cellPadding`      | `2`       | Gap between cells (0 = touching).                                             |
| Corner radius (px) | `cellCornerRadius` | `2`       | Rounded cell corners.                                                         |
| Border color       | `cellStroke`       | blank     | Per-cell stroke; blank = none.                                                |
| Border width (px)  | `cellStrokeWidth`  | `0`       |                                                                               |
| Aspect             | `cellAspect`       | `Fit`     | **Fit** (stretch to size) or **Square** (force square cells; height derived). |
| No-data color      | `noDataColor`      | `#f3f4f6` | Fill for (x,y) with no data. `transparent` leaves a gap.                      |

### Colors

| Property             | `name`              | Default      | Description                                                                                                                                              |
| -------------------- | ------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scale type           | `colorScaleType`    | `Sequential` | **Sequential** (continuous ramp), **Diverging** (two-sided around a midpoint), **Quantize** (discrete buckets).                                          |
| Color scheme         | `colorScheme`       | `Blues`      | Blues, Greens, Oranges, Reds, Purples, Viridis, Inferno, Magma, Cividis, YlOrRd, YlGnBu, RdYlGn, RdBu, Spectral. (Any scheme works with any scale type.) |
| Reverse scheme       | `reverseColors`     | `false`      | Flip the ramp.                                                                                                                                           |
| Value domain minimum | `colorMin`          | auto         | Fix the low end of the color domain. Blank = data min.                                                                                                   |
| Value domain maximum | `colorMax`          | auto         | Fix the high end. Blank = data max.                                                                                                                      |
| Diverging midpoint   | `divergingMidpoint` | auto         | _Diverging only._ Value at the ramp center. Blank = data mean.                                                                                           |
| Quantize steps       | `quantizeSteps`     | `5`          | _Quantize only._ Number of discrete buckets.                                                                                                             |

### X-axis (columns)

| Property            | `name`          | Default  | Description                                                         |
| ------------------- | --------------- | -------- | ------------------------------------------------------------------- |
| Column sort         | `sortX`         | `None`   | None / Ascending / Descending (by label) / By value (column total). |
| Title               | `xAxisLabel`    | blank    |                                                                     |
| Position            | `xAxisPosition` | `Bottom` | Bottom or Top column labels.                                        |
| Tick label rotation | `xTickRotation` | `0`      | Degrees, e.g. -45.                                                  |

### Y-axis (rows)

| Property | `name`       | Default | Description                                                      |
| -------- | ------------ | ------- | ---------------------------------------------------------------- |
| Row sort | `sortY`      | `None`  | None / Ascending / Descending (by label) / By value (row total). |
| Title    | `yAxisLabel` | blank   |                                                                  |

### Axes (shared)

| Property    | `name`           | Default   |
| ----------- | ---------------- | --------- |
| Line color  | `axisColor`      | `#6b7280` |
| Text color  | `axisTextColor`  | `#6b7280` |
| Font size   | `axisFontSize`   | `12`      |
| Font family | `axisFontFamily` | blank     |

### Color legend

| Property    | `name`                | Default | Description                                      |
| ----------- | --------------------- | ------- | ------------------------------------------------ |
| Show legend | `showColorLegend`     | `true`  | Gradient color legend mapping color -> value.    |
| Position    | `colorLegendPosition` | `Right` | Right (vertical bar) or Bottom (horizontal bar). |
| Title       | `colorLegendTitle`    | blank   |                                                  |
| Tick format | `colorLegendFormat`   | blank   | D3 number format for legend ticks.               |

### Labels

| Property                  | `name`              | Default | Description                                                 |
| ------------------------- | ------------------- | ------- | ----------------------------------------------------------- |
| Show cell values          | `showCellLabels`    | `false` | Draw the value inside each cell.                            |
| Value format              | `cellLabelFormat`   | blank   | D3 number format for in-cell labels.                        |
| Font size                 | `cellLabelFontSize` | `11`    |                                                             |
| Color                     | `cellLabelColor`    | blank   | Blank = **auto black/white contrast** per cell vs its fill. |
| Hide below cell size (px) | `cellLabelMinSize`  | `18`    | Hide labels when cells are smaller than this.               |

### Tooltip

| Property                | `name`                                   | Default                                 | Description                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Show tooltip            | `showTooltip`                            | `true`                                  |                                                                                                                                                                                             |
| Template                | `tooltipTemplate`                        | `{swatch}<strong>{x} . {y}</strong>...` | Tokens: `{x}`, `{y}`, `{value}`, `{formattedValue}`, `{rowIndex}`, `{colIndex}`, `{swatch}`, `{color}`, plus any custom cell key. Interpolated values are HTML-escaped (except `{swatch}`). |
| Follow cursor           | `tooltipFollowCursor`                    | `true`                                  |                                                                                                                                                                                             |
| Background / Text color | `tooltipBackground` / `tooltipTextColor` | `rgba(17,24,39,0.92)` / `#ffffff`       |                                                                                                                                                                                             |
| Font size               | `tooltipFontSize`                        | `12`                                    |                                                                                                                                                                                             |

---

## Color scale behaviors

- **Sequential** (`scaleSequential`): the value domain `[min, max]` maps linearly
  onto the chosen interpolator. Best for one-directional data (counts, durations).
- **Diverging** (`scaleDiverging`): the domain is `[min, midpoint, max]`; the
  midpoint sits at the center of the ramp (use a diverging scheme like RdBu /
  RdYlGn / Spectral). Blank `divergingMidpoint` = the data mean. Great for
  above/below-a-target data.
- **Quantize** (`scaleQuantize`): the domain is split into `quantizeSteps`
  discrete buckets, each a fixed color sampled from the interpolator -- a banded
  look rather than a smooth gradient.
- **Domain bounds:** `colorMin` / `colorMax` pin the color domain (blank = auto
  from data) so multiple heatmaps can share one color scale.
- **Reverse:** `reverseColors` flips the interpolator.
- **Auto-contrast labels:** when `cellLabelColor` is blank, each in-cell value
  label is drawn black or white based on the relative luminance of its cell color,
  so labels stay legible across the ramp.

---

## Events (actions)

| Action          | When                         | Payload                                   |
| --------------- | ---------------------------- | ----------------------------------------- |
| `CHART_CLICKED` | Click the chart (not a cell) | `cellCount`, `rowCount`, `colCount`       |
| `CELL_CLICKED`  | Click a cell (drill-in)      | `x`, `y`, `value`, `rowIndex`, `colIndex` |
| `CELL_HOVERED`  | Hover a cell                 | `x`, `y`, `value`                         |

In UI Builder, add an event handler on `CELL_CLICKED` to navigate, open a record,
or set a page parameter using the clicked cell's `x`/`y`/`value`. `CELL_CLICKED`
calls `stopPropagation()` so it doesn't also fire `CHART_CLICKED`.

---

## Verify without an instance

`chart.js` imports only d3 submodules, so it can be bundled and run headless:

```bash
node scripts/verify_chart.mjs --chart src/x-2114311-heatmap-chart-uic/chart.js
```

The harness esbuild-bundles `chart.js` with real d3, runs `drawChart` in jsdom
across a matrix of property scenarios (diverging/quantize scales, reversed/fixed
colors, sparse data, cell labels, the explicit-order object form, square aspect,
x-axis top, every sort, legend right/bottom, single cell, empty data, all-equal
values, a large matrix, tick rotation, ...) and asserts an `<svg>` is produced
with no exceptions.
