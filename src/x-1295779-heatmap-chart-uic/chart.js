/**
 * D3 matrix-heatmap renderer.
 *
 * `drawChart` fully (re)renders the chart into `container` on every call. It owns
 * the SVG subtree imperatively while the Seismic/snabbdom view only provides the
 * stable host container. Re-rendering on each property change keeps the
 * look-and-feel fully driven by the UI Builder property panel.
 *
 * We import the specific d3 functions we use as NAMED imports (rather than
 * `import * as d3`): the ServiceNow production build tree-shakes a namespace
 * object that's passed around, which would strip methods like `select`.
 *
 * No `d3-transition` -- it gets tree-shaken out of the prod bundle. The fade/grow
 * animation runs on `requestAnimationFrame`.
 *
 * dispatch(actionName, payload) emits the custom actions declared in now-ui.json
 * (CHART_CLICKED / CELL_CLICKED / CELL_HOVERED) so page authors can hook them as
 * event handlers in UI Builder.
 *
 * DATA SHAPE (differs from the line/column chart): a FLAT array of cells
 *   [ { x, y, value }, ... ]
 * where x is the column category, y is the row category, and value drives the
 * cell COLOR (not a bar/line height). Missing (x,y) pairs render as blank cells.
 * An explicit-order object form is also accepted:
 *   { xCategories: [...], yCategories: [...], cells: [ { x, y, value } ] }
 */
import { select } from 'd3-selection';
import { scaleBand, scaleSequential, scaleDiverging, scaleQuantize, scaleLinear } from 'd3-scale';
import { axisBottom, axisLeft, axisTop } from 'd3-axis';
import {
	interpolateBlues, interpolateGreens, interpolateOranges, interpolateReds,
	interpolatePurples, interpolateViridis, interpolateInferno, interpolateMagma,
	interpolateCividis, interpolateYlOrRd, interpolateYlGnBu,
	interpolateRdYlGn, interpolateRdBu, interpolateSpectral
} from 'd3-scale-chromatic';
import { format } from 'd3-format';
import { color as d3color } from 'd3-color';
import {
	easeLinear, easeCubicOut, easeCubicInOut, easeQuadOut,
	easeExpOut, easeBackOut, easeBounceOut, easeElasticOut
} from 'd3-ease';

// Color interpolators selectable via the `colorScheme` property.
const INTERPOLATORS = {
	blues: interpolateBlues,
	greens: interpolateGreens,
	oranges: interpolateOranges,
	reds: interpolateReds,
	purples: interpolatePurples,
	viridis: interpolateViridis,
	inferno: interpolateInferno,
	magma: interpolateMagma,
	cividis: interpolateCividis,
	YlOrRd: interpolateYlOrRd,
	YlGnBu: interpolateYlGnBu,
	RdYlGn: interpolateRdYlGn,
	RdBu: interpolateRdBu,
	spectral: interpolateSpectral
};

// Easing curves selectable via the `animationEasing` property.
const EASINGS = {
	linear: easeLinear,
	cubicOut: easeCubicOut,
	cubicInOut: easeCubicInOut,
	quadOut: easeQuadOut,
	expOut: easeExpOut,
	backOut: easeBackOut,
	bounceOut: easeBounceOut,
	elasticOut: easeElasticOut
};

const num = (v, fallback) => {
	const n = typeof v === 'string' ? parseFloat(v) : v;
	return Number.isFinite(n) ? n : fallback;
};

const isBlank = (v) => v === undefined || v === null || v === '';

/**
 * Normalize the `data` property into { xCats, yCats, cellMap, cells }.
 * Auto-detects: Array -> flat cells (categories inferred first-seen);
 * object with `cells` -> explicit-order form (categories taken from
 * xCategories/yCategories when provided, else inferred).
 */
const normalizeData = (raw) => {
	let cells = [];
	let explicitX = null;
	let explicitY = null;
	if (Array.isArray(raw)) {
		cells = raw;
	} else if (raw && typeof raw === 'object' && Array.isArray(raw.cells)) {
		cells = raw.cells;
		if (Array.isArray(raw.xCategories)) explicitX = raw.xCategories.map((v) => String(v));
		if (Array.isArray(raw.yCategories)) explicitY = raw.yCategories.map((v) => String(v));
	}

	const clean = [];
	const xSeen = {};
	const ySeen = {};
	const xOrder = [];
	const yOrder = [];
	for (let i = 0; i < cells.length; i += 1) {
		const c = cells[i];
		if (!c || c.x === undefined || c.x === null || c.y === undefined || c.y === null) continue;
		const x = String(c.x);
		const y = String(c.y);
		const value = num(c.value, NaN);
		clean.push({ x, y, value, raw: c });
		if (!xSeen[x]) { xSeen[x] = true; xOrder.push(x); }
		if (!ySeen[y]) { ySeen[y] = true; yOrder.push(y); }
	}

	// Explicit category lists win for ordering; otherwise first-seen order.
	const xCats = explicitX && explicitX.length ? explicitX.slice() : xOrder;
	const yCats = explicitY && explicitY.length ? explicitY.slice() : yOrder;
	// Make sure any explicit list still includes every category present in data.
	xOrder.forEach((x) => { if (xCats.indexOf(x) === -1) xCats.push(x); });
	yOrder.forEach((y) => { if (yCats.indexOf(y) === -1) yCats.push(y); });

	const cellMap = {};
	clean.forEach((c) => { cellMap[`${c.x} ${c.y}`] = c; });

	return { xCats, yCats, cellMap, cells: clean };
};

/** Sort a category list by the chosen mode using per-category value totals. */
const sortCategories = (cats, mode, totals) => {
	if (!mode || mode === 'none') return cats;
	const out = cats.slice();
	if (mode === 'value') {
		out.sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
	} else {
		out.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
		if (mode === 'desc') out.reverse();
	}
	return out;
};

/** Relative luminance of a CSS color -> pick black or white text for contrast. */
const contrastColor = (cssColor) => {
	const c = d3color(cssColor);
	if (!c) return '#111827';
	const rgb = c.rgb();
	const lin = (v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
	return L > 0.55 ? '#111827' : '#ffffff';
};

export function drawChart(container, props, dispatch) {
	// ----- normalize data (flat array OR explicit-order object) -----
	const { xCats: xCats0, yCats: yCats0, cellMap, cells } = normalizeData(props.data);

	// per-category totals (for value sorting + tooltips)
	const xTotals = {};
	const yTotals = {};
	cells.forEach((c) => {
		if (!Number.isFinite(c.value)) return;
		xTotals[c.x] = (xTotals[c.x] || 0) + c.value;
		yTotals[c.y] = (yTotals[c.y] || 0) + c.value;
	});

	const sortX = ['none', 'asc', 'desc', 'value'].indexOf(props.sortX) > -1 ? props.sortX : 'none';
	const sortY = ['none', 'asc', 'desc', 'value'].indexOf(props.sortY) > -1 ? props.sortY : 'none';
	const xCats = sortCategories(xCats0, sortX, xTotals);
	const yCats = sortCategories(yCats0, sortY, yTotals);

	// ----- normalize look-and-feel props -----
	const colorScaleType = ['sequential', 'diverging', 'quantize'].indexOf(props.colorScaleType) > -1 ? props.colorScaleType : 'sequential';
	const colorScheme = INTERPOLATORS[props.colorScheme] ? props.colorScheme : 'blues';
	const reverseColors = props.reverseColors === true;
	const quantizeSteps = Math.max(2, Math.round(num(props.quantizeSteps, 5)));

	const cellPadding = Math.max(0, num(props.cellPadding, 2));
	const cellCornerRadius = Math.max(0, num(props.cellCornerRadius, 2));
	const cellStroke = props.cellStroke || '';
	const cellStrokeWidth = Math.max(0, num(props.cellStrokeWidth, 0));
	const cellAspect = props.cellAspect === 'square' ? 'square' : 'fit';
	const nullCellColor = props.nullCellColor || '#f3f4f6';

	const xAxisPosition = props.xAxisPosition === 'top' ? 'top' : 'bottom';
	const xTickRotation = Math.max(-90, Math.min(90, num(props.xTickRotation, 0)));

	const titleFontSize = num(props.titleFontSize, 18);
	const axisFontSize = num(props.axisFontSize, 12);
	const cellLabelFontSize = num(props.cellLabelFontSize, 11);
	const cellLabelMinSize = Math.max(0, num(props.cellLabelMinSize, 18));
	const shadowBlur = Math.max(0, num(props.shadowBlur, 4));

	const animationDuration = Math.max(0, num(props.animationDuration, 800));
	const animate = props.animate !== false && animationDuration > 0;
	const animationStagger = Math.max(0, num(props.animationStagger, 6));
	const easeFn = EASINGS[props.animationEasing] || easeCubicOut;

	const dropShadow = props.dropShadow === true;
	const hoverHighlight = props.hoverHighlight !== false;
	const showColorLegend = props.showColorLegend !== false;
	const colorLegendPosition = props.colorLegendPosition === 'bottom' ? 'bottom' : 'right';
	const colorLegendTitle = props.colorLegendTitle || '';
	const showCellLabels = props.showCellLabels === true;
	const cellLabelColor = props.cellLabelColor || '';

	const axisColor = props.axisColor || '#6b7280';
	const axisTextColor = props.axisTextColor || '#6b7280';
	const backgroundColor = props.backgroundColor || 'transparent';
	const fontFamily = props.fontFamily || 'inherit';
	const axisFontFamily = props.axisFontFamily || fontFamily;
	const chartTitle = props.chartTitle || '';
	const titleColor = props.titleColor || '#374151';
	const xAxisLabel = props.xAxisLabel || '';
	const yAxisLabel = props.yAxisLabel || '';

	const showTooltip = props.showTooltip !== false;
	const tooltipTemplate = isBlank(props.tooltipTemplate)
		? '{swatch}<strong>{x} · {y}</strong><br/>{formattedValue}'
		: props.tooltipTemplate;
	const tooltipFollowCursor = props.tooltipFollowCursor !== false;
	const tooltipBackground = props.tooltipBackground || 'rgba(17,24,39,0.92)';
	const tooltipTextColor = props.tooltipTextColor || '#ffffff';
	const tooltipFontSize = num(props.tooltipFontSize, 12);

	const makeFmt = (spec) => {
		if (isBlank(spec)) return (n) => `${n}`;
		try { return format(spec); } catch (e) { return (n) => `${n}`; }
	};
	const cellFmt = makeFmt(props.cellLabelFormat);
	const legendFmt = makeFmt(props.colorLegendFormat);

	// ----- value domain (drives the color scale) -----
	const finite = cells.map((c) => c.value).filter((v) => Number.isFinite(v));
	const dataMin = finite.length ? Math.min.apply(null, finite) : 0;
	const dataMax = finite.length ? Math.max.apply(null, finite) : 1;
	const dataMean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
	const domMin = isBlank(props.colorMin) ? dataMin : num(props.colorMin, dataMin);
	let domMax = isBlank(props.colorMax) ? dataMax : num(props.colorMax, dataMax);
	if (domMax === domMin) domMax = domMin + 1; // avoid a zero-width domain (all-equal values)

	// interpolator with optional reversal
	const baseInterp = INTERPOLATORS[colorScheme];
	const interp = reverseColors ? (t) => baseInterp(1 - t) : baseInterp;

	// build the value -> color scale per scale type
	let colorScale;
	if (colorScaleType === 'diverging') {
		const autoMid = (dataMean >= domMin && dataMean <= domMax) ? dataMean : (domMin + domMax) / 2;
		const mid = isBlank(props.divergingMidpoint) ? autoMid : num(props.divergingMidpoint, autoMid);
		colorScale = scaleDiverging([domMin, mid, domMax], interp);
	} else if (colorScaleType === 'quantize') {
		const range = [];
		for (let i = 0; i < quantizeSteps; i += 1) {
			range.push(interp(quantizeSteps === 1 ? 0.5 : i / (quantizeSteps - 1)));
		}
		colorScale = scaleQuantize().domain([domMin, domMax]).range(range);
	} else {
		colorScale = scaleSequential([domMin, domMax], interp);
	}
	const fillFor = (v) => (Number.isFinite(v) ? colorScale(v) : nullCellColor);

	// ----- clear previous render -----
	const root = select(container);
	root.selectAll('*').remove();

	// ----- dimensions -----
	const rect = container.getBoundingClientRect();
	const measuredW = Math.floor(rect.width) || container.clientWidth || 0;
	const width = Math.max(220, measuredW || 600);
	let height = Math.max(120, num(props.chartHeight, 360));

	// ----- root svg + click target -----
	const svg = root
		.append('svg')
		.attr('class', 'hc-svg')
		.style('font-family', fontFamily)
		.style('display', 'block')
		.on('click', () => {
			dispatch('CHART_CLICKED', { cellCount: cells.length, rowCount: yCats.length, colCount: xCats.length });
		});

	const drawEmpty = (w, h) => {
		svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);
		svg.append('rect').attr('class', 'hc-bg').attr('width', w).attr('height', h).attr('fill', backgroundColor);
		if (chartTitle) {
			svg.append('text').attr('class', 'hc-title')
				.attr('x', w / 2).attr('y', titleFontSize + 2)
				.attr('text-anchor', 'middle').attr('fill', titleColor)
				.style('font-size', `${titleFontSize}px`).style('font-weight', '600').text(chartTitle);
		}
		svg.append('text')
			.attr('x', w / 2).attr('y', h / 2)
			.attr('text-anchor', 'middle').attr('fill', axisColor)
			.style('font-size', `${axisFontSize}px`).text('No data to display');
	};

	if (!xCats.length || !yCats.length) {
		drawEmpty(width, height);
		return;
	}

	// ----- layout margins -----
	const margin = { top: 8, right: 12, bottom: 8, left: 12 };

	// reserve for the longest y (row) label
	const longestY = yCats.reduce((m, k) => Math.max(m, String(k).length), 0);
	margin.left += Math.min(180, Math.max(28, longestY * axisFontSize * 0.6));

	// reserve for x (column) labels on the chosen side, accounting for rotation
	const longestX = xCats.reduce((m, k) => Math.max(m, String(k).length), 0);
	const xLabelExtent = xTickRotation
		? Math.round(Math.sin(Math.abs(xTickRotation) * Math.PI / 180) * longestX * axisFontSize * 0.62) + axisFontSize
		: axisFontSize + 8;
	if (xAxisPosition === 'top') margin.top += xLabelExtent + 6;
	else margin.bottom += xLabelExtent + 6;

	if (chartTitle) margin.top += titleFontSize + 18;
	if (yAxisLabel) margin.left += axisFontSize + 8;
	if (xAxisLabel) {
		if (xAxisPosition === 'top') margin.top += axisFontSize + 8;
		else margin.bottom += axisFontSize + 10;
	}

	// reserve for the color legend
	const legendThick = 14; // bar thickness
	const legendTickRoom = axisFontSize + 8;
	const legendGap = 16;
	const legendTitleRoom = colorLegendTitle ? axisFontSize + 6 : 0;
	if (showColorLegend) {
		if (colorLegendPosition === 'right') {
			margin.right += legendThick + legendTickRoom + legendGap + legendTitleRoom;
		} else {
			margin.bottom += legendThick + legendTickRoom + legendGap + legendTitleRoom;
		}
	}

	// ----- inner grid size; honor square aspect -----
	let innerW = Math.max(10, width - margin.left - margin.right);
	let innerH = Math.max(10, height - margin.top - margin.bottom);

	if (cellAspect === 'square') {
		// derive a square cell side from the available width, then size height to fit.
		const cellSide = innerW / xCats.length;
		innerH = cellSide * yCats.length;
		height = innerH + margin.top + margin.bottom;
	}

	svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
	svg.append('rect').attr('class', 'hc-bg').attr('width', width).attr('height', height).attr('fill', backgroundColor);

	if (dropShadow) {
		const defs = svg.append('defs');
		const filter = defs.append('filter')
			.attr('id', 'hc-shadow')
			.attr('x', '-30%').attr('y', '-30%')
			.attr('width', '160%').attr('height', '160%');
		filter.append('feDropShadow')
			.attr('dx', 0).attr('dy', 1)
			.attr('stdDeviation', shadowBlur)
			.attr('flood-color', props.shadowColor || 'rgba(0,0,0,0.25)');
	}

	const plot = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	// ----- band scales -----
	const innerPadX = (cellPadding > 0 && (innerW / xCats.length) > 0)
		? Math.min(0.6, cellPadding / (innerW / xCats.length))
		: 0;
	const innerPadY = (cellPadding > 0 && (innerH / yCats.length) > 0)
		? Math.min(0.6, cellPadding / (innerH / yCats.length))
		: 0;
	const x = scaleBand().domain(xCats).range([0, innerW]).paddingInner(innerPadX).paddingOuter(innerPadX / 2);
	const y = scaleBand().domain(yCats).range([0, innerH]).paddingInner(innerPadY).paddingOuter(innerPadY / 2);
	const bw = x.bandwidth();
	const bh = y.bandwidth();
	const cornerR = Math.min(cellCornerRadius, Math.min(bw, bh) / 2);

	// ----- axes (category labels; ticks-only, no domain line) -----
	const xAxisGen = (xAxisPosition === 'top' ? axisTop(x) : axisBottom(x)).tickSize(0).tickPadding(6);
	const yAxisGen = axisLeft(y).tickSize(0).tickPadding(6);

	const xAxis = plot.append('g').attr('class', 'hc-axis hc-axis-x')
		.attr('transform', `translate(0,${xAxisPosition === 'top' ? 0 : innerH})`)
		.call(xAxisGen);
	const yAxis = plot.append('g').attr('class', 'hc-axis hc-axis-y').call(yAxisGen);

	[xAxis, yAxis].forEach((axis) => {
		axis.select('.domain').remove();
		axis.selectAll('text').attr('fill', axisTextColor)
			.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily);
	});

	if (xTickRotation !== 0) {
		const anchor = xTickRotation < 0 ? 'end' : 'start';
		xAxis.selectAll('text')
			.attr('transform', `rotate(${xTickRotation})`)
			.style('text-anchor', anchor)
			.attr('dx', xTickRotation < 0 ? '-0.4em' : '0.4em')
			.attr('dy', '0.3em');
	}

	// ----- cells (full grid; missing cells render as blanks) -----
	const cellLayer = plot.append('g').attr('class', 'hc-cells')
		.attr('filter', dropShadow ? 'url(#hc-shadow)' : null);

	const grid = [];
	yCats.forEach((yc, ri) => {
		xCats.forEach((xc, ci) => {
			const c = cellMap[`${xc} ${yc}`];
			grid.push({
				x: xc, y: yc, ci, ri,
				value: c && Number.isFinite(c.value) ? c.value : null,
				present: !!c,
				raw: c ? c.raw : null
			});
		});
	});

	const maxDiag = Math.max(1, (xCats.length - 1) + (yCats.length - 1));

	const cellSel = cellLayer.selectAll('rect').data(grid).join('rect')
		.attr('class', 'hc-cell')
		.attr('x', (d) => x(d.x))
		.attr('y', (d) => y(d.y))
		.attr('width', Math.max(0, bw))
		.attr('height', Math.max(0, bh))
		.attr('rx', cornerR)
		.attr('ry', cornerR)
		.attr('fill', (d) => (d.value === null ? nullCellColor : fillFor(d.value)))
		.attr('stroke', cellStroke && cellStrokeWidth > 0 ? cellStroke : 'none')
		.attr('stroke-width', cellStroke && cellStrokeWidth > 0 ? cellStrokeWidth : null)
		.style('cursor', 'pointer');

	// ----- in-cell value labels (auto-contrast) -----
	const minCellSide = Math.min(bw, bh);
	const showLabelsNow = showCellLabels && minCellSide >= cellLabelMinSize;
	if (showLabelsNow) {
		cellLayer.append('g').attr('class', 'hc-cell-labels').style('pointer-events', 'none')
			.selectAll('text').data(grid.filter((d) => d.value !== null)).join('text')
			.attr('x', (d) => x(d.x) + bw / 2)
			.attr('y', (d) => y(d.y) + bh / 2)
			.attr('text-anchor', 'middle')
			.attr('dominant-baseline', 'central')
			.attr('fill', (d) => (cellLabelColor ? cellLabelColor : contrastColor(fillFor(d.value))))
			.style('font-size', `${cellLabelFontSize}px`)
			.style('font-family', fontFamily)
			.style('opacity', animate ? 0 : 1)
			.text((d) => cellFmt(d.value));
	}

	// ----- tooltip -----
	const tooltipEl = showTooltip
		? root.append('div').attr('class', 'hc-tooltip')
			.style('background', tooltipBackground).style('color', tooltipTextColor)
			.style('font-size', `${tooltipFontSize}px`).style('font-family', fontFamily)
			.style('opacity', 0).style('display', 'none')
		: null;

	const escapeHtml = (s) => String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	const swatchHtml = (cssColor) => {
		const safe = String(cssColor).replace(/[^a-zA-Z0-9#(),.%\s-]/g, '');
		return `<span class="hc-tt-swatch" style="background:${safe}"></span>`;
	};
	const renderTemplate = (d) => {
		const fill = d.value === null ? nullCellColor : fillFor(d.value);
		const ctx = Object.assign({}, d.raw || {}, {
			x: d.x, y: d.y,
			value: d.value === null ? '' : d.value,
			formattedValue: d.value === null ? 'no data' : cellFmt(d.value),
			rowIndex: d.ri, colIndex: d.ci, color: fill
		});
		return tooltipTemplate.replace(/\{(\w+)\}/g, (m, key) => {
			if (key === 'swatch') return swatchHtml(fill);
			const v = ctx[key];
			return (v === undefined || v === null) ? '' : escapeHtml(v);
		});
	};

	const placeTooltip = (clientX, clientY, anchorPx, anchorPy) => {
		if (!tooltipEl) return;
		const cr = container.getBoundingClientRect();
		const node = tooltipEl.node();
		const tw = node.offsetWidth;
		const th = node.offsetHeight;
		let xPos;
		let yPos;
		if (tooltipFollowCursor) {
			xPos = clientX - cr.left + 14;
			yPos = clientY - cr.top + 14;
			if (yPos + th > cr.height) yPos = clientY - cr.top - th - 14;
		} else {
			xPos = margin.left + anchorPx - tw / 2;
			yPos = margin.top + anchorPy - th - 10;
			if (yPos < 0) yPos = margin.top + anchorPy + 10;
		}
		if (xPos + tw > cr.width) xPos = cr.width - tw - 4;
		if (xPos < 0) xPos = 4;
		if (yPos < 0) yPos = 4;
		tooltipEl.style('left', `${xPos}px`).style('top', `${yPos}px`);
	};

	// hover outline overlay (drawn above cells so it isn't clipped by neighbors)
	const hoverRect = hoverHighlight
		? plot.append('rect').attr('class', 'hc-hover').style('pointer-events', 'none')
			.attr('fill', 'none').attr('stroke-width', 2).attr('rx', cornerR)
			.style('opacity', 0)
		: null;

	cellSel
		.on('mouseenter', function (event, d) {
			if (hoverRect) {
				hoverRect
					.attr('x', x(d.x)).attr('y', y(d.y))
					.attr('width', Math.max(0, bw)).attr('height', Math.max(0, bh))
					.attr('stroke', d.value === null ? axisColor : contrastColor(fillFor(d.value)))
					.style('opacity', 1);
			}
			if (tooltipEl) {
				tooltipEl.html(renderTemplate(d)).style('display', 'block').style('opacity', 1);
				placeTooltip(event.clientX, event.clientY, x(d.x) + bw / 2, y(d.y));
			}
			dispatch('CELL_HOVERED', { x: d.x, y: d.y, value: d.value });
		})
		.on('mousemove', function (event, d) {
			if (tooltipEl) placeTooltip(event.clientX, event.clientY, x(d.x) + bw / 2, y(d.y));
		})
		.on('mouseleave', function () {
			if (hoverRect) hoverRect.style('opacity', 0);
			if (tooltipEl) tooltipEl.style('opacity', 0).style('display', 'none');
		})
		.on('click', function (event, d) {
			event.stopPropagation();
			dispatch('CELL_CLICKED', { x: d.x, y: d.y, value: d.value, rowIndex: d.ri, colIndex: d.ci });
		});

	// ----- title -----
	if (chartTitle) {
		svg.append('text').attr('class', 'hc-title')
			.attr('x', width / 2).attr('y', titleFontSize + 2)
			.attr('text-anchor', 'middle').attr('fill', titleColor)
			.style('font-size', `${titleFontSize}px`).style('font-weight', '600').text(chartTitle);
	}

	// ----- axis titles -----
	if (xAxisLabel) {
		const tyTop = (chartTitle ? titleFontSize + 18 : 0) + axisFontSize;
		const tyBottom = margin.top + innerH + xLabelExtent + axisFontSize + 6;
		svg.append('text').attr('class', 'hc-axis-title')
			.attr('x', margin.left + innerW / 2).attr('y', xAxisPosition === 'top' ? tyTop : tyBottom)
			.attr('text-anchor', 'middle').attr('fill', axisTextColor)
			.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily).text(xAxisLabel);
	}
	if (yAxisLabel) {
		svg.append('text').attr('class', 'hc-axis-title')
			.attr('transform', `translate(${14},${margin.top + innerH / 2}) rotate(-90)`)
			.attr('text-anchor', 'middle').attr('fill', axisTextColor)
			.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily).text(yAxisLabel);
	}

	// ----- color legend (gradient bar) -----
	if (showColorLegend) {
		const legend = svg.append('g').attr('class', 'hc-legend');
		const defs = svg.append('defs');
		const gradId = 'hc-legend-grad';
		const STOPS = 24;
		const valueAt = (t) => domMin + t * (domMax - domMin);

		if (colorLegendPosition === 'right') {
			const barH = Math.max(40, innerH * 0.8);
			const barX = margin.left + innerW + legendGap;
			const barY = margin.top + (innerH - barH) / 2;
			const grad = defs.append('linearGradient').attr('id', gradId)
				.attr('x1', 0).attr('y1', 1).attr('x2', 0).attr('y2', 0); // top = high value
			for (let i = 0; i <= STOPS; i += 1) {
				const t = i / STOPS;
				grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', fillFor(valueAt(t)));
			}
			legend.append('rect')
				.attr('x', barX).attr('y', barY).attr('width', legendThick).attr('height', barH)
				.attr('fill', `url(#${gradId})`).attr('stroke', axisColor).attr('stroke-width', 0.5);

			const ls = scaleLinear().domain([domMin, domMax]).range([barY + barH, barY]);
			const axis = legend.append('g').attr('class', 'hc-legend-axis')
				.attr('transform', `translate(${barX + legendThick},0)`)
				.call(axisLeft(ls).ticks(5).tickSize(4).tickFormat(isBlank(props.colorLegendFormat) ? null : legendFmt));
			axis.selectAll('line').attr('x2', 4).attr('stroke', axisColor);
			axis.selectAll('text').attr('x', 7).style('text-anchor', 'start')
				.attr('fill', axisTextColor).style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily);
			axis.select('.domain').remove();

			if (colorLegendTitle) {
				legend.append('text')
					.attr('transform', `translate(${barX + legendThick + legendTickRoom + axisFontSize},${barY + barH / 2}) rotate(-90)`)
					.attr('text-anchor', 'middle').attr('fill', axisTextColor)
					.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily)
					.style('font-weight', '600').text(colorLegendTitle);
			}
		} else {
			const barW = Math.max(60, innerW * 0.6);
			const barX = margin.left + (innerW - barW) / 2;
			const barY = height - margin.bottom + legendGap - legendTickRoom; // sits inside the reserved bottom band
			const grad = defs.append('linearGradient').attr('id', gradId)
				.attr('x1', 0).attr('y1', 0).attr('x2', 1).attr('y2', 0); // left = low value
			for (let i = 0; i <= STOPS; i += 1) {
				const t = i / STOPS;
				grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', fillFor(valueAt(t)));
			}
			legend.append('rect')
				.attr('x', barX).attr('y', barY).attr('width', barW).attr('height', legendThick)
				.attr('fill', `url(#${gradId})`).attr('stroke', axisColor).attr('stroke-width', 0.5);

			const ls = scaleLinear().domain([domMin, domMax]).range([barX, barX + barW]);
			const axis = legend.append('g').attr('class', 'hc-legend-axis')
				.attr('transform', `translate(0,${barY + legendThick})`)
				.call(axisBottom(ls).ticks(5).tickSize(4).tickFormat(isBlank(props.colorLegendFormat) ? null : legendFmt));
			axis.selectAll('line').attr('stroke', axisColor);
			axis.selectAll('text').attr('fill', axisTextColor)
				.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily);
			axis.select('.domain').remove();

			if (colorLegendTitle) {
				legend.append('text')
					.attr('x', barX + barW / 2).attr('y', barY - 5)
					.attr('text-anchor', 'middle').attr('fill', axisTextColor)
					.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily)
					.style('font-weight', '600').text(colorLegendTitle);
			}
		}
	}

	// ----- fade/grow-in animation (cells + labels) via requestAnimationFrame -----
	if (animate && typeof requestAnimationFrame === 'function') {
		const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : new Date().getTime());
		const t0 = now();
		const maxDelay = animationStagger * maxDiag;
		const total = animationDuration + maxDelay;
		cellSel.style('opacity', 0);
		const labelSel = showLabelsNow ? cellLayer.selectAll('.hc-cell-labels text') : null;
		const tick = () => {
			const elapsed = now() - t0;
			cellSel.each(function (d) {
				const delay = animationStagger * (d.ci + d.ri);
				const k = easeFn(Math.max(0, Math.min(1, (elapsed - delay) / animationDuration)));
				const cx = x(d.x) + bw / 2;
				const cy = y(d.y) + bh / 2;
				const w = Math.max(0, bw) * k;
				const h = Math.max(0, bh) * k;
				select(this)
					.style('opacity', k)
					.attr('x', cx - w / 2).attr('y', cy - h / 2)
					.attr('width', w).attr('height', h);
			});
			if (elapsed < total) {
				requestAnimationFrame(tick);
			} else {
				cellSel.style('opacity', 1)
					.attr('x', (d) => x(d.x)).attr('y', (d) => y(d.y))
					.attr('width', Math.max(0, bw)).attr('height', Math.max(0, bh));
			}
		};
		requestAnimationFrame(tick);
		if (labelSel) {
			labelSel.style('transition', `opacity 300ms ease ${Math.round(total * 0.5)}ms`);
			requestAnimationFrame(() => labelSel.style('opacity', 1));
		}
	}
}
