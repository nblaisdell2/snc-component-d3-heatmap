import "../src/x-2114311-heatmap-chart-uic";
import { mountDevHarness } from "./dev-harness";

mountDevHarness(document.body);

/* ---------------------------------------------------------------------------
 * Plain-element fallback (no controls harness). To preview the bare component,
 * comment out the mountDevHarness(...) call above and uncomment this block.
 * ------------------------------------------------------------------------- */
// const el = document.createElement('DIV');
// document.body.appendChild(el);
// el.innerHTML = `
// 	<x-2114311-heatmap-chart-uic></x-2114311-heatmap-chart-uic>
// `;
