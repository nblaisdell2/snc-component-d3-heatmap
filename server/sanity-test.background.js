/**
 * Sanity test for the D3MatrixData Script Include.
 * Run in System Definition -> Scripts - Background (Global scope) AFTER creating
 * the D3MatrixData Script Include. It logs the cell JSON so you can confirm the
 * shape ([ { x, y, value } ]) before wiring it into the page. Adjust the cfg
 * objects to your data.
 */
(function () {
	var api = new global.D3MatrixData();

	gs.info('--- fromAggregate: incidents by priority (x) and state (y), count ---');
	gs.info(JSON.stringify(api.fromAggregate({
		table: 'incident',
		xField: 'priority',
		yField: 'state',
		metric: 'count',
		useDisplayValue: true,
		sortX: 'asc',
		sortY: 'asc'
	}), null, 2));

	gs.info('--- fromAggregate: avg reassignment_count by assignment_group (x) x category (y) ---');
	gs.info(JSON.stringify(api.fromAggregate({
		table: 'incident',
		xField: 'assignment_group',
		yField: 'category',
		metric: 'avg',
		valueField: 'reassignment_count',
		useDisplayValue: true
	}), null, 2));

	gs.info('--- fromRows: reshape plain objects into cells ---');
	var rows = [
		{ day: 'Mon', hour: '9am', hits: 12 },
		{ day: 'Mon', hour: '12pm', hits: 30 },
		{ day: 'Tue', hour: '9am', hits: 9 },
		{ day: 'Tue', hour: '12pm', hits: 27 },
		{ day: 'Mon', hour: '9am', hits: 3 }  // duplicate -> combined via metric (sum)
	];
	gs.info(JSON.stringify(api.fromRows(rows, {
		xField: 'day', yField: 'hour', valueField: 'hits', metric: 'sum', sortY: 'none'
	}), null, 2));
})();
