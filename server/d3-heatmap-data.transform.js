/**
 * Script for the "D3 Heatmap Data" Transform data resource
 * (table: sys_ux_data_broker_transform, "Mutates server data" = false).
 *
 * Paste this into the data resource's Script field. `input` is an object whose
 * keys are the data resource's Properties (see d3-heatmap-data.properties.json).
 * The returned value is the data resource output, bound in UI Builder via
 *   @data.<data_resource_name>.output
 * to the component's "Data . Cells" property.
 *
 * All heavy lifting lives in the global D3MatrixData Script Include. Unlike the
 * line/column chart (which uses D3ChartData and groups by ONE category field to
 * produce a `series` array), the heatmap groups by TWO fields (xField and
 * yField) to produce a flat array of { x, y, value } CELLS.
 */
function transform(input) {
	return new global.D3MatrixData().fromAggregate(input);
}
