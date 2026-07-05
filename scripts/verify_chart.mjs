#!/usr/bin/env node
/**
 * Headless verification for the ServiceNow D3 Heatmap renderer.
 *
 * Bundles chart.js (which imports only d3 submodules) with real d3 via esbuild,
 * then runs drawChart(container, props, dispatch) in jsdom across a property
 * matrix, asserting an <svg> is produced with no exceptions.
 *
 * Usage:
 *   node verify_chart.mjs --chart <path-to-chart.js> [--export <fnName>]
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
const chartPath = get('--chart');
const exportName = get('--export') || 'drawChart';
if (!chartPath) { console.error('Usage: node verify_chart.mjs --chart <path-to-chart.js>'); process.exit(2); }

const DEPS = join(tmpdir(), 'snc-d3-verify-heatmap');
if (!existsSync(join(DEPS, 'node_modules', 'esbuild'))) {
  console.log('Installing verify deps (d3@7, jsdom, esbuild) into ' + DEPS + ' ...');
  mkdirSync(DEPS, { recursive: true });
  execSync('npm init -y', { cwd: DEPS, stdio: 'ignore' });
  execSync('npm install d3@7 jsdom esbuild', { cwd: DEPS, stdio: 'inherit' });
}
const req = createRequire(pathToFileURL(join(DEPS, 'package.json')));
const esbuild = req('esbuild');
const { JSDOM } = req('jsdom');

const outfile = join(DEPS, 'chart.cjs');
esbuild.buildSync({
  entryPoints: [chartPath], bundle: true, format: 'cjs', platform: 'node',
  outfile, nodePaths: [join(DEPS, 'node_modules')], logLevel: 'warning'
});

const dom = new JSDOM('<!DOCTYPE html><body><div id="c"></div></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
try { if (!global.navigator) global.navigator = dom.window.navigator; } catch (_) { /* read-only: fine */ }
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.performance = global.performance || { now: () => Date.now() };
global.ResizeObserver = class { observe() {} disconnect() {} };
const container = document.getElementById('c');
container.getBoundingClientRect = () => ({ width: 640, height: 360, left: 0, top: 0, right: 640, bottom: 360 });
Object.defineProperty(container, 'clientWidth', { value: 640, configurable: true });

const bundle = req(outfile);
const drawChart = bundle[exportName];
if (typeof drawChart !== 'function') { console.error('Export "' + exportName + '" not found in bundle.'); process.exit(2); }

// ----- heatmap sample data: a flat array of { x, y, value } cells -----
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const HOURS = ['9am', '12pm', '3pm', '6pm'];
const SAMPLE = [];
DAYS.forEach((d, di) => HOURS.forEach((h, hi) => {
  SAMPLE.push({ x: d, y: h, value: (di * 7 + hi * 11) % 40 });
}));

const SPARSE = [
  { x: 'A', y: 'r1', value: 3 },
  { x: 'B', y: 'r2', value: 8 },
  { x: 'C', y: 'r1', value: 5 },
  { x: 'A', y: 'r3', value: 12 },
  { x: 'D', y: 'r2', value: 1 }
];

const EXPLICIT = {
  xCategories: ['Q4', 'Q3', 'Q2', 'Q1'],
  yCategories: ['East', 'West', 'North', 'South'],
  cells: [
    { x: 'Q1', y: 'North', value: 10 }, { x: 'Q2', y: 'North', value: 22 },
    { x: 'Q3', y: 'East', value: 31 }, { x: 'Q4', y: 'West', value: 7 },
    { x: 'Q1', y: 'South', value: 18 }, { x: 'Q4', y: 'East', value: 25 }
  ]
};

const SIGNED = [];
['Jan', 'Feb', 'Mar', 'Apr'].forEach((m, mi) => ['A', 'B', 'C'].forEach((g, gi) => {
  SIGNED.push({ x: m, y: g, value: (mi - 1.5) * (gi + 1) * 6 });
}));

const LARGE = [];
for (let i = 0; i < 24; i += 1) {
  for (let j = 0; j < 20; j += 1) {
    LARGE.push({ x: 'c' + i, y: 'r' + j, value: (i * j) % 50 });
  }
}

const ALL_EQUAL = [
  { x: 'A', y: 'r1', value: 5 }, { x: 'B', y: 'r1', value: 5 },
  { x: 'A', y: 'r2', value: 5 }, { x: 'B', y: 'r2', value: 5 }
];

const base = { data: SAMPLE, chartHeight: 360, chartTitle: 'Test Heatmap' };
const SCENARIOS = [
  ['defaults', {}],
  ['no title', { chartTitle: '' }],
  ['animate off', { animate: false }],
  ['diverging scale (signed)', { data: SIGNED, colorScaleType: 'diverging', colorScheme: 'RdBu' }],
  ['diverging w/ explicit midpoint', { data: SIGNED, colorScaleType: 'diverging', colorScheme: 'RdYlGn', divergingMidpoint: 0 }],
  ['quantize scale', { colorScaleType: 'quantize', quantizeSteps: 5 }],
  ['quantize 3 steps', { colorScaleType: 'quantize', quantizeSteps: 3 }],
  ['reversed colors', { reverseColors: true }],
  ['fixed colorMin/Max', { colorMin: 0, colorMax: 100 }],
  ['fixed colorMin only', { colorMin: 10 }],
  ['sparse / missing cells', { data: SPARSE }],
  ['cell labels on', { showCellLabels: true }],
  ['cell labels custom color', { showCellLabels: true, cellLabelColor: '#000000' }],
  ['cell labels formatted', { showCellLabels: true, cellLabelFormat: ',.0f' }],
  ['explicit categories object', { data: EXPLICIT }],
  ['square aspect', { cellAspect: 'square' }],
  ['x-axis top', { xAxisPosition: 'top' }],
  ['sort X asc', { sortX: 'asc' }],
  ['sort X desc', { sortX: 'desc' }],
  ['sort X by value', { sortX: 'value' }],
  ['sort Y asc', { sortY: 'asc' }],
  ['sort Y desc', { sortY: 'desc' }],
  ['sort Y by value', { sortY: 'value' }],
  ['sort both by value', { sortX: 'value', sortY: 'value' }],
  ['legend right', { showColorLegend: true, colorLegendPosition: 'right' }],
  ['legend bottom', { showColorLegend: true, colorLegendPosition: 'bottom' }],
  ['legend off', { showColorLegend: false }],
  ['legend titled', { showColorLegend: true, colorLegendTitle: 'Count', colorLegendFormat: '.0f' }],
  ['single cell', { data: [{ x: 'only', y: 'one', value: 42 }] }],
  ['empty data', { data: [] }],
  ['all-equal values', { data: ALL_EQUAL }],
  ['large matrix', { data: LARGE }],
  ['large matrix + labels', { data: LARGE, showCellLabels: true }],
  ['tick rotation -45', { xTickRotation: -45 }],
  ['tick rotation -90', { xTickRotation: -90 }],
  ['drop shadow', { dropShadow: true }],
  ['cell stroke', { cellStroke: '#333333', cellStrokeWidth: 1 }],
  ['no cell gap', { cellPadding: 0 }],
  ['transparent no-data cells', { data: SPARSE, noDataColor: 'transparent' }],
  ['viridis scheme', { colorScheme: 'viridis' }],
  ['spectral diverging', { colorScaleType: 'diverging', colorScheme: 'spectral' }],
  ['axis titles', { xAxisLabel: 'Day', yAxisLabel: 'Hour' }],
  ['axis titles + top x', { xAxisLabel: 'Day', yAxisLabel: 'Hour', xAxisPosition: 'top' }],
  ['tooltip off', { showTooltip: false }],
  ['tooltip anchored', { tooltipFollowCursor: false }],
  ['hover off', { hoverHighlight: false }],
  ['null value cell (NaN)', { data: [{ x: 'A', y: 'r1', value: null }, { x: 'B', y: 'r1', value: 9 }] }],
  ['custom gradient', { colorMode: 'custom', customColorStart: '#ebedf0', customColorEnd: '#216e39' }],
  ['custom gradient reversed', { colorMode: 'custom', customColorStart: '#fee0d2', customColorEnd: '#a50f15', reverseColors: true }],
  ['value color scheme', { valueColorScheme: 'plasma' }],
  ['value color scheme quantize', { valueColorScheme: 'turbo', colorScaleType: 'quantize' }],
  ['hover color', { hoverColor: '#ff0000' }],
  ['hover dim others', { hoverDimOthers: true }],
  ['legend margin', { showColorLegend: true, colorLegendMargin: 24 }],
  ['legend title left', { showColorLegend: true, colorLegendPosition: 'right', colorLegendTitle: 'Count', colorLegendTitlePosition: 'left' }],
  ['legend title bottom', { showColorLegend: true, colorLegendPosition: 'bottom', colorLegendTitle: 'Count', colorLegendTitlePosition: 'bottom' }]
];

let pass = 0;
let fail = 0;
for (const [name, override] of SCENARIOS) {
  container.innerHTML = '';
  try {
    drawChart(container, Object.assign({}, base, override), () => {});
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('no <svg> produced');
    pass += 1;
    console.log('  ok    ' + name);
  } catch (e) {
    fail += 1;
    console.log('  FAIL  ' + name + ': ' + (e && e.message ? e.message : e));
  }
}
console.log('');
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
