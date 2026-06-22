/**
 * Built-in sample data so the component renders something meaningful the moment
 * it is dropped onto a page, before the author binds the `data` property to a
 * real data resource. Mirrors the `data` default in index.js / now-ui.json.
 *
 * Shape: a FLAT array of cells, each { x, y, value } where:
 *   - x     = the column category (X axis)
 *   - y     = the row category    (Y axis)
 *   - value = the numeric value that drives the cell's COLOR
 *
 * This is fundamentally different from the line/column chart's `series` array
 * (which carries one named, colored series per line with { label, value }
 * points). Here color encodes `value`, and BOTH x and y are categorical axes.
 *
 * The sample below is a small day x hour activity matrix (logins per hour).
 */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = ['6am', '9am', '12pm', '3pm', '6pm', '9pm'];

// A plausible weekday/weekend activity profile keyed by hour, per day.
const PROFILE = {
	Mon: [4, 38, 52, 47, 22, 9],
	Tue: [6, 41, 55, 50, 25, 11],
	Wed: [5, 44, 58, 53, 27, 10],
	Thu: [7, 40, 54, 49, 24, 12],
	Fri: [8, 36, 48, 41, 30, 18],
	Sat: [3, 14, 21, 19, 26, 22],
	Sun: [2, 9, 15, 13, 17, 14]
};

const cells = [];
DAYS.forEach((day) => {
	HOURS.forEach((hour, hi) => {
		cells.push({ x: day, y: hour, value: PROFILE[day][hi] });
	});
});

export const SAMPLE_DATA = cells;
