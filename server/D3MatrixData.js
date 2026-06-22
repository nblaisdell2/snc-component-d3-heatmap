/**
 * D3MatrixData -- Script Include (global, accessible from all application scopes)
 * ---------------------------------------------------------------------------
 * Reusable transform that turns platform data into the JSON shape expected by
 * the x-1295779-heatmap-chart-uic component's "Data . Cells" property:
 *
 *   [ { x: "<column>", y: "<row>", value: <number> }, ... ]
 *
 * This is DIFFERENT from the D3ChartData "series" contract used by the line and
 * column charts: there is NO per-series array and NO { label, value } points.
 * Instead the heatmap groups by TWO category fields (an X/column field and a
 * Y/row field) to produce a flat list of CELLS, and the cell's numeric `value`
 * is mapped to a COLOR by the component (not to a bar/line height).
 *
 * Two entry points:
 *   - fromAggregate(cfg)  : server-side GlideAggregate grouped by xField AND
 *                           yField with a metric (count/sum/avg/min/max).
 *   - fromRows(rows, cfg) : reshape an array of already-fetched plain objects
 *                           into cells (xField/yField/valueField, dup-combine).
 *
 * Written in ES5 for broad scoped/global compatibility (no let/const/arrow
 * functions/template literals).
 */
var D3MatrixData = Class.create();
D3MatrixData.prototype = {

	initialize: function () {},

	/**
	 * Aggregate a table into heatmap cells.
	 * cfg: {
	 *   table, filter,
	 *   xField (column category), yField (row category),
	 *   metric (count|sum|avg|min|max), valueField (required if metric != count),
	 *   useDisplayValue (default true), sortX?, sortY?
	 *   (colorMin/colorMax are accepted but ignored -- the component handles color)
	 * }
	 */
	fromAggregate: function (cfg) {
		cfg = cfg || {};
		var table = this._str(cfg.table);
		var xField = this._str(cfg.xField);
		var yField = this._str(cfg.yField);
		if (!table || !xField || !yField) {
			return [];
		}
		var metric = (this._str(cfg.metric) || 'count').toLowerCase();
		var valueField = this._str(cfg.valueField);
		var useDisplay = cfg.useDisplayValue !== false && cfg.useDisplayValue !== 'false';
		if (metric !== 'count' && !valueField) {
			return []; // sum/avg/min/max need a numeric field
		}

		var ga = new GlideAggregate(table);
		if (this._str(cfg.filter)) {
			ga.addEncodedQuery(cfg.filter);
		}
		ga.groupBy(xField);
		ga.groupBy(yField);
		if (metric === 'count') {
			ga.addAggregate('COUNT');
		} else {
			ga.addAggregate(metric.toUpperCase(), valueField);
		}
		ga.orderBy(xField);
		ga.orderBy(yField);
		ga.query();

		var rows = [];
		while (ga.next()) {
			var xLabel = useDisplay ? ga.getDisplayValue(xField) : ga.getValue(xField);
			var yLabel = useDisplay ? ga.getDisplayValue(yField) : ga.getValue(yField);
			var value;
			if (metric === 'count') {
				value = parseInt(ga.getAggregate('COUNT'), 10);
			} else {
				value = parseFloat(ga.getAggregate(metric.toUpperCase(), valueField));
			}
			rows.push({
				x: this._blank(xLabel),
				y: this._blank(yLabel),
				value: isNaN(value) ? 0 : value
			});
		}
		return this._buildCells(rows, cfg, null);
	},

	/**
	 * Reshape an array of plain objects into heatmap cells.
	 * cfg: { xField, yField, valueField, metric? (dup-combine: sum|avg|min|max,
	 *        default sum), sortX?, sortY? }
	 */
	fromRows: function (rows, cfg) {
		cfg = cfg || {};
		rows = rows || [];
		var xField = this._str(cfg.xField);
		var yField = this._str(cfg.yField);
		var valueField = this._str(cfg.valueField);

		var collected = [];
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i] || {};
			var value = parseFloat(this._readField(r, valueField));
			collected.push({
				x: this._blank(this._readField(r, xField)),
				y: this._blank(this._readField(r, yField)),
				value: isNaN(value) ? 0 : value
			});
		}
		return this._buildCells(collected, cfg, (this._str(cfg.metric) || 'sum').toLowerCase());
	},

	// ----- internals -------------------------------------------------------

	/**
	 * Build the flat cell array from rows {x, y, value}, combining duplicates
	 * with dupMetric (null = assume unique; otherwise sum|avg|min|max), then
	 * apply optional sortX / sortY ordering of the categories.
	 */
	_buildCells: function (rows, cfg, dupMetric) {
		var xOrder = [];
		var yOrder = [];
		var xSeen = {};
		var ySeen = {};
		var bucket = {};   // "x y" -> value
		var counts = {};   // "x y" -> count (for avg)

		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			if (!xSeen[row.x]) { xSeen[row.x] = true; xOrder.push(row.x); }
			if (!ySeen[row.y]) { ySeen[row.y] = true; yOrder.push(row.y); }
			var key = row.x + ' ' + row.y;
			if (bucket[key] === undefined) {
				bucket[key] = row.value;
				counts[key] = 1;
			} else {
				var m = dupMetric || 'sum';
				if (m === 'min') { bucket[key] = Math.min(bucket[key], row.value); }
				else if (m === 'max') { bucket[key] = Math.max(bucket[key], row.value); }
				else { bucket[key] += row.value; }
				counts[key]++;
			}
		}
		if (dupMetric === 'avg') {
			for (var k in bucket) {
				if (bucket.hasOwnProperty(k)) { bucket[k] = bucket[k] / counts[k]; }
			}
		}

		this._sortCategories(xOrder, 'x', bucket, this._str(cfg.sortX));
		this._sortCategories(yOrder, 'y', bucket, this._str(cfg.sortY));

		var out = [];
		for (var yi = 0; yi < yOrder.length; yi++) {
			for (var xi = 0; xi < xOrder.length; xi++) {
				var bk = xOrder[xi] + ' ' + yOrder[yi];
				if (bucket[bk] !== undefined) {
					out.push({ x: String(xOrder[xi]), y: String(yOrder[yi]), value: bucket[bk] });
				}
			}
		}
		return out;
	},

	/**
	 * Sort a category list in place. mode: none|asc|desc|value.
	 * 'value' ranks by the category's total value across the other axis (desc).
	 */
	_sortCategories: function (cats, axis, bucket, mode) {
		mode = (mode || '').toLowerCase();
		if (!mode || mode === 'none') { return; }
		if (mode === 'value') {
			var totals = {};
			for (var c = 0; c < cats.length; c++) { totals[cats[c]] = 0; }
			for (var key in bucket) {
				if (!bucket.hasOwnProperty(key)) { continue; }
				var parts = key.split(' ');
				var cat = (axis === 'x') ? parts[0] : parts[1];
				if (totals[cat] !== undefined) { totals[cat] += bucket[key]; }
			}
			cats.sort(function (a, b) { return totals[b] - totals[a]; });
		} else {
			cats.sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
			if (mode === 'desc') { cats.reverse(); }
		}
	},

	_readField: function (obj, field) {
		if (!field) { return ''; }
		var v = obj[field];
		if (v && typeof v === 'object') {
			if (typeof v.getDisplayValue === 'function') { return v.getDisplayValue(); }
			if (v.displayValue !== undefined) { return v.displayValue; }
			if (v.value !== undefined) { return v.value; }
		}
		return (v === undefined || v === null) ? '' : v;
	},

	_str: function (v) {
		return (v === undefined || v === null) ? '' : ('' + v).replace(/^\s+|\s+$/g, '');
	},

	_blank: function (v) {
		var s = (v === undefined || v === null) ? '' : ('' + v);
		return s === '' ? '(empty)' : s;
	},

	type: 'D3MatrixData'
};
