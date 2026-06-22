# server/

Platform-side sources for binding real data to the **D3 Heatmap** component.
Create these as records on the instance (they are NOT shipped by
`snc ui-component deploy`):

| File | What it is |
|---|---|
| `D3MatrixData.js` | Script Include -- `fromAggregate()`, `fromRows()` -> heatmap cells |
| `d3-heatmap-data.transform.js` | Transform data resource script (delegates to `fromAggregate`) |
| `d3-heatmap-data.properties.json` | The data resource's input properties (bare JSON array) |
| `sanity-test.background.js` | Background script to log the cell JSON before wiring it |

## How this differs from the line/column chart server side

The line/column charts use the **`D3ChartData`** Script Include, which groups by
**one** category field and pivots into a `series` array of
`{ name, color, data: [ { label, value } ] }`. The heatmap uses **`D3MatrixData`**,
which groups by **two** fields (an X/column field and a Y/row field) and emits a
**flat array of cells** `[ { x, y, value } ]`. The cell `value` is mapped to a
COLOR by the component, not to a bar/line height. The two Script Includes are
independent -- you can have both on the same instance.

## Setup (one time)

1. **Create the Script Include.** *System Definition -> Script Includes -> New*.
   Name it `D3MatrixData`, set **Accessible from = All application scopes**,
   **Client callable = false**, and paste `D3MatrixData.js`. Save.
2. **Create the Transform data resource.** In UI Builder:
   **Add data resource -> Transform** (creates a `sys_ux_data_broker_transform`
   record).
   - Name it e.g. `D3 Heatmap Data`, leave **Mutates server data** unchecked.
   - Paste `d3-heatmap-data.transform.js` into the **Script** field.
   - Paste the **bare JSON array** from `d3-heatmap-data.properties.json` into the
     **Properties** field (must be just the `[ ... ]` array -- if it's wrapped in
     an object or has a `readOnly` entry, the config panel stays blank and **Add**
     is disabled).
3. **Create the execute ACL** (required -- the resource won't run without it, and
   UI Builder may not prompt you to create it; without it you get "ACL failed for
   databroker"):
   - Get the data broker's **sys_id** (`sys_ux_data_broker_transform.list` ->
     open the record -> copy sys_id).
   - **Elevate roles:** profile menu -> **Elevate role** -> **security_admin**.
   - **System Security -> Access Control (ACL) -> New**:
     - **Type** = `ux_data_broker`
     - **Operation** = `execute`
     - **Name** = paste the data broker **sys_id** (click the padlock to switch
       Name to free text)
     - **Active** = true
     - Add **one** permissive criterion (newer instances reject a fully empty
       ACL): Security Attribute **`UserIsAuthenticated`** (any logged-in user), or
       a specific role, or Advanced script `answer = gs.isLoggedIn();`.
   - **Submit**, then reload UI Builder.

## Bind it

In UI Builder, set the component's **Data . Cells** property to
`@data.<resource_name>.output` (e.g. `@data.d3_heatmap_data.output`).

## fromAggregate(cfg) inputs

`table`, `filter`, `xField` (column category), `yField` (row category),
`metric` (`count`/`sum`/`avg`/`min`/`max`), `valueField` (required when metric
is not `count`), `useDisplayValue`. Optional `sortX`/`sortY`
(`none`/`asc`/`desc`/`value`) pre-order the categories on the server (the
component can also sort on the client).

## Verify

Run `sanity-test.background.js` in *Scripts - Background* (Global scope) to log
the cell JSON before wiring it into a page.

> These are **platform records** (Script Include / data resource / ACL), not part
> of the component bundle. The `server/` files are the version-controlled source.
