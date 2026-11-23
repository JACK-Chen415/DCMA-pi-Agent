import assert from "node:assert/strict";
import test from "node:test";
import {
	COLUMN_WIDTH_DEFAULT_NARROW,
	COLUMN_WIDTH_DEFAULT_WIDE,
	COLUMN_WIDTH_MIN,
	COLUMN_WIDTH_STEP,
	clampColumnWidth,
	defaultColumnWidth,
	parseStoredColumnWidth,
	stepColumnWidth,
	WIDE_VIEWPORT_MIN,
} from "../src/column-width.ts";

test("wide viewports start at 1088, narrow viewports keep 800", () => {
	assert.equal(defaultColumnWidth(true), COLUMN_WIDTH_DEFAULT_WIDE);
	assert.equal(defaultColumnWidth(false), COLUMN_WIDTH_DEFAULT_NARROW);
	assert.equal(defaultColumnWidth(true), 1088);
	assert.equal(defaultColumnWidth(false), 800);
});

test("the large-display threshold is a fixed 2000 CSS pixels", () => {
	assert.equal(WIDE_VIEWPORT_MIN, 2000);
});

test("widths only have a lower bound", () => {
	assert.equal(clampColumnWidth(700), COLUMN_WIDTH_MIN);
	assert.equal(clampColumnWidth(1000.6), 1001);
	assert.equal(clampColumnWidth(1800), 1800);
	assert.equal(clampColumnWidth(2600), 2600);
	assert.equal(clampColumnWidth(Number.NaN), COLUMN_WIDTH_DEFAULT_WIDE);
});

test("each wheel notch or arrow key moves 48px and stops at the minimum only", () => {
	assert.equal(COLUMN_WIDTH_STEP, 48);
	assert.equal(stepColumnWidth(1088, 1), 1136);
	assert.equal(stepColumnWidth(1088, -1), 1040);
	assert.equal(stepColumnWidth(COLUMN_WIDTH_MIN, -1), COLUMN_WIDTH_MIN);
	assert.equal(stepColumnWidth(1936, 1), 1984);
});

test("stored widths are restored or ignored", () => {
	assert.equal(parseStoredColumnWidth("1200"), 1200);
	assert.equal(parseStoredColumnWidth(" 968 "), 968);
	assert.equal(parseStoredColumnWidth("2600"), 2600);
	assert.equal(parseStoredColumnWidth("400"), COLUMN_WIDTH_MIN);
	assert.equal(parseStoredColumnWidth(null), null);
	assert.equal(parseStoredColumnWidth(""), null);
	assert.equal(parseStoredColumnWidth("abc"), null);
	assert.equal(parseStoredColumnWidth("Infinity"), null);
});
