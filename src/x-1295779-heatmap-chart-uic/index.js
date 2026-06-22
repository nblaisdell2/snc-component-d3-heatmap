import { createCustomElement, actionTypes } from '@servicenow/ui-core';
import snabbdom from '@servicenow/ui-renderer-snabbdom';
import styles from './styles.scss';
import { drawChart } from './chart';
import { SAMPLE_DATA } from './sampleData';

const { COMPONENT_RENDERED, COMPONENT_DOM_READY, COMPONENT_PROPERTY_CHANGED, COMPONENT_DISCONNECTED } = actionTypes;

/**
 * The view only renders a single stable container. D3 owns everything inside it
 * and is driven imperatively from the lifecycle action handlers below -- mixing
 * snabbdom's virtual DOM with D3's direct DOM mutation on the same nodes is what
 * you want to avoid, so we keep them on separate elements.
 */
const view = () => <div className="hc-root" />;

/** Resolve the D3 mount node inside the (open) shadow root. */
const getContainer = (host) =>
	host && host.shadowRoot
		? host.shadowRoot.querySelector('.hc-root') || host.shadowRoot.querySelector('div')
		: null;

/** Coerce a UI Builder value into a CSS length ("50%", "12px"; bare numbers -> px). */
const cssLen = (v, fallback) => {
	if (v === undefined || v === null || v === '') return fallback;
	return /^\d+(\.\d+)?$/.test(String(v)) ? `${v}px` : String(v);
};

/**
 * Is the `data` property usefully populated? Accepts both the flat-array form
 * ([ { x, y, value } ]) and the explicit-order object form
 * ({ xCategories, yCategories, cells: [...] }). Empty/unbound -> use the sample.
 */
const hasData = (d) => {
	if (Array.isArray(d)) return d.length > 0;
	if (d && typeof d === 'object' && Array.isArray(d.cells)) return d.cells.length > 0;
	return false;
};

/** Render with the sample-data fallback applied when `data` is empty. */
const render = ({ host, properties, dispatch }) => {
	const container = getContainer(host);
	if (!container) return;
	// Configurable outer footprint so the widget need not span the full page width.
	host.style.display = 'block';
	host.style.boxSizing = 'border-box';
	host.style.width = cssLen(properties.componentWidth, '100%');
	host.style.maxWidth = '100%';
	host.style.padding = cssLen(properties.componentPadding, '0');
	// optional widget border (Header & border section)
	const borderW = parseFloat(properties.borderWidth) || 0;
	host.style.border = properties.borderColor && borderW > 0
		? `${borderW}px solid ${properties.borderColor}`
		: 'none';
	host.style.borderRadius = cssLen(properties.borderRadius, '0');
	const data = hasData(properties.data) ? properties.data : SAMPLE_DATA;
	const effectiveProps = { ...properties, data };
	// stash latest inputs so the ResizeObserver can redraw on container resize
	host._hcLast = { container, props: effectiveProps, dispatch };
	try {
		drawChart(container, effectiveProps, dispatch);
		// Record the width we just drew at so the ResizeObserver can distinguish a real
		// resize from its own initial/no-op callback -- that callback would otherwise
		// repaint with animation off and snap the fade-in straight to its end state.
		host._hcWidth = container.getBoundingClientRect().width || container.clientWidth || 0;
	} catch (e) {
		// Safety net: surface a render failure instead of failing silently.
		container.textContent = `Chart error: ${e && e.message ? e.message : String(e)}`;
		// eslint-disable-next-line no-console
		if (typeof console !== 'undefined') console.error('[heatmap] render failed', e);
	}
};

createCustomElement('x-1295779-heatmap-chart-uic', {
	renderer: { type: snabbdom },
	view,
	styles,
	properties: {
		// Keep in sync with now-ui.json. JSON-typed defaults (data) live HERE.
		data: { default: SAMPLE_DATA },
		chartTitle: { default: 'Activity by Day & Hour' },
		titleFontSize: { default: 18 },
		titleColor: { default: '#374151' },
		componentWidth: { default: '50%' },
		componentPadding: { default: '12px' },
		backgroundColor: { default: 'transparent' },
		borderColor: { default: '' },
		borderWidth: { default: 0 },
		borderRadius: { default: 0 },
		chartHeight: { default: 360 },
		fontFamily: { default: '' },
		dropShadow: { default: false },
		shadowColor: { default: 'rgba(0,0,0,0.25)' },
		shadowBlur: { default: 4 },
		hoverHighlight: { default: true },
		animate: { default: true },
		animationDuration: { default: 800 },
		animationEasing: { default: 'cubicOut' },
		animationStagger: { default: 6 },
		cellPadding: { default: 2 },
		cellCornerRadius: { default: 2 },
		cellStroke: { default: '' },
		cellStrokeWidth: { default: 0 },
		cellAspect: { default: 'fit' },
		nullCellColor: { default: '#f3f4f6' },
		colorScaleType: { default: 'sequential' },
		colorScheme: { default: 'blues' },
		reverseColors: { default: false },
		colorMin: { default: null },
		colorMax: { default: null },
		divergingMidpoint: { default: null },
		quantizeSteps: { default: 5 },
		sortX: { default: 'none' },
		xAxisLabel: { default: '' },
		xAxisPosition: { default: 'bottom' },
		xTickRotation: { default: 0 },
		sortY: { default: 'none' },
		yAxisLabel: { default: '' },
		axisColor: { default: '#6b7280' },
		axisTextColor: { default: '#6b7280' },
		axisFontSize: { default: 12 },
		axisFontFamily: { default: '' },
		showColorLegend: { default: true },
		colorLegendPosition: { default: 'right' },
		colorLegendTitle: { default: '' },
		colorLegendFormat: { default: '' },
		showCellLabels: { default: false },
		cellLabelFormat: { default: '' },
		cellLabelFontSize: { default: 11 },
		cellLabelColor: { default: '' },
		cellLabelMinSize: { default: 18 },
		showTooltip: { default: true },
		tooltipTemplate: { default: '{swatch}<strong>{x} · {y}</strong><br/>{formattedValue}' },
		tooltipFollowCursor: { default: true },
		tooltipBackground: { default: 'rgba(17,24,39,0.92)' },
		tooltipTextColor: { default: '#ffffff' },
		tooltipFontSize: { default: 12 }
	},
	actionHandlers: {
		// Fires after each (re)render -- covers initial paint.
		[COMPONENT_RENDERED]: render,
		// The view is static (doesn't read props), so a property change won't always
		// re-render it. Redraw explicitly when any UI Builder property changes.
		[COMPONENT_PROPERTY_CHANGED]: render,
		// First reliable DOM: wire a ResizeObserver so the chart is responsive to
		// its UI Builder slot without re-animating on every property tweak.
		[COMPONENT_DOM_READY]: (coeffects) => {
			const { host } = coeffects;
			render(coeffects);
			if (typeof ResizeObserver !== 'undefined' && !host._hcResizeObserver) {
				const ro = new ResizeObserver(() => {
					const last = host._hcLast;
					if (!last || !last.container) return;
					const w = last.container.getBoundingClientRect().width || last.container.clientWidth || 0;
					const prevW = host._hcWidth || 0;
					// Only redraw on a genuine width change. observe() fires an initial
					// no-op callback; ignoring it (and height-only changes) keeps the
					// initial fade-in animation from being snapped to its end state.
					if (Math.abs(w - prevW) < 1) return;
					const wasUnsized = prevW < 1; // first real width after a 0-width initial measure
					host._hcWidth = w;
					drawChart(last.container, { ...last.props, animate: wasUnsized ? last.props.animate : false }, last.dispatch);
				});
				const target = getContainer(host);
				if (target) {
					ro.observe(target);
					host._hcResizeObserver = ro;
				}
			}
		},
		[COMPONENT_DISCONNECTED]: ({ host }) => {
			if (host._hcResizeObserver) {
				host._hcResizeObserver.disconnect();
				host._hcResizeObserver = null;
			}
		}
	}
});
