import assert from "node:assert/strict";
import test from "node:test";
import { createCodeHistory } from "../../../dashboard/database/code-events.ts";
import { checkDataQuality, getCodeEvents, summarizeMetrics } from "../tools/analytics.ts";
import { chartFixture } from "./chart-fixture.ts";

test("full-window averages remain distinct from a page of identical two-minute events", () => {
	const from = "2026-10-21T10:00:00.000Z";
	const to = "2026-10-28T10:00:00.000Z";
	const history = createCodeHistory({ table: "real_data_01", page: 1, from, to });
	for (let index = 0; index < 336; index++) {
		const startMinutes = index < 286 ? Math.floor(index / 2) * 60 + (index % 2) * 20 : index * 30;
		const start = Date.parse(from) + startMinutes * 60000;
		// Older events have 20/40-minute intervals and one/three-minute spans; the page shows 30 and two.
		const minutes = index < 286 ? (index % 2 === 0 ? 1 : 3) : 2;
		for (const [part, offset] of [0, minutes * 60000 - 4000, minutes * 60000].entries())
			history.add({
				id: index * 3 + part,
				timestamp: String(start + offset),
				fault_code: "0",
				alarm_code: part === 2 ? "0" : "A07089",
			});
	}
	const result = getCodeEvents({
		table: "real_data_01",
		from,
		to,
		queriedAt: to,
		complete: true,
		availableFields: ["fault_code", "alarm_code"],
		excludedIdentityRows: 0,
		invalidTimeRowsInSource: 0,
		invalidTimeRecords: 0,
		timeValidRecords: 1008,
		firstSampleAt: from,
		lastSampleAt: to,
		history: history.finish(),
		codeCoverage: [
			{ field: "fault_code", usable: 1008, missing: 0 },
			{ field: "alarm_code", usable: 1008, missing: 0 },
		],
	});
	assert.equal(result.total, 336);
	assert.equal(result.events.length, 50);
	assert.equal(result.eventDetailScope.coversAllEvents, false);
	assert.equal(result.eventDetailScope.returned, 50);
	assert.equal(result.eventDetailScope.total, 336);
	assert.equal(result.eventDetailScope.firstStartedAt, "2026-10-27T09:00:00.000Z");
	assert.equal(result.eventDetailScope.lastStartedAt, "2026-10-28T09:30:00.000Z");
	assert.equal(result.metricAlignment, "not_performed");
	assert.equal(result.eventsTruncated, true);
	assert.equal(result.hasMore, true);
	assert.equal(result.codes[0].durationMs, 40320000);
	assert.equal(result.codes[0].observedDurationMinutes, 672);
	assert.equal(result.codes[0].meanObservedDurationMinutes, 2);
	assert.ok(
		result.events.every(
			(event) => event.endedAt !== null && Date.parse(event.endedAt) - Date.parse(event.startedAt) === 120000,
		),
	);
	assert.match(result.eventDetailScope.note, /平均值不能证明每次同长或严格周期/);
	const empty = getCodeEvents({
		table: "real_data_01",
		from,
		to,
		queriedAt: to,
		complete: true,
		availableFields: ["fault_code", "alarm_code"],
		excludedIdentityRows: 0,
		invalidTimeRowsInSource: 0,
		invalidTimeRecords: 0,
		timeValidRecords: 0,
		firstSampleAt: null,
		lastSampleAt: null,
		history: createCodeHistory({ table: "real_data_01", page: 1, from, to }).finish(),
		codeCoverage: [
			{ field: "fault_code", usable: 0, missing: 0 },
			{ field: "alarm_code", usable: 0, missing: 0 },
		],
	});
	assert.equal(empty.eventDetailScope.total, null);
	assert.equal(empty.eventDetailScope.coversAllEvents, null);
	assert.equal(empty.eventDetailScope.firstStartedAt, null);
	assert.equal(empty.eventDetailScope.lastStartedAt, null);
});

test("a complete query with no missing metric values can still contain a sampling gap", () => {
	const { window } = chartFixture([38, 38, 38, 38, 38]);
	window.records.splice(2, 1);
	const summary = summarizeMetrics(window, ["motor_temp"], 20);
	assert.equal(summary.complete, true);
	assert.equal(summary.metrics[0].missing, 0);
	assert.equal(summary.metrics[0].mean, 38);
	assert.equal(checkDataQuality(window, ["motor_temp"], 15).gapCount, 1);
	assert.equal(summary.analysisScope.samplingContinuity, "not_checked");
	assert.equal(summary.analysisScope.eventAlignment, "not_checked");
});
