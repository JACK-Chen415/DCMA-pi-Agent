import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticPreview } from "../tools/diagnostic-preview.ts";

test("oversized diagnostic preview preserves full-window aggregates and leaves chart data intact", () => {
	const details = Array.from({ length: 120 }, (_, index) => ({
		startedAt: new Date(index * 1000).toISOString(),
		code: "F".repeat(120),
	}));
	const rows = Array.from({ length: 200 }, (_, index) => [index, ...Array(64).fill(123.456)]);
	const input = {
		statistics: { records: 80000, metrics: [{ mean: 38, min: 12, max: 96 }], trend: { rows } },
		events: {
			total: 120,
			codes: [{ count: 120, durationMs: 8000 }],
			events: details,
			eventDetailScope: { total: 120 },
		},
		references: [{ id: "example", tool: "search_fault_knowledge", result: "资料".repeat(10000) }],
	};
	const output = diagnosticPreview(input, 62000) as typeof input;
	assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 62000);
	assert.deepEqual(output.statistics.metrics, input.statistics.metrics);
	assert.equal(output.statistics.records, 80000);
	assert.deepEqual(output.events.codes, input.events.codes);
	assert.equal(output.events.total, 120);
	assert.equal(output.events.eventDetailScope.total, 120);
	assert.ok(output.statistics.trend.rows.length < 200);
	assert.equal(input.statistics.trend.rows.length, 200);
	assert.equal(input.events.events.length, 120);
	assert.deepEqual(output.references, [{ id: "example", tool: "search_fault_knowledge" }]);
});
