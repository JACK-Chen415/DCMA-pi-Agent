import assert from "node:assert/strict";
import { test } from "node:test";
import { getMetrics, getSpectrum, parseTelemetry, telemetryCsv } from "../src/telemetry.ts";

const fixture =
	"timestamp,temperature,vibration,current,speed\n2026-10-08T00:00:00Z,49,0.2,310,1498\n2026-10-08T00:00:01Z,51,0.3,312,1499\n2026-10-08T00:00:02Z,52,0.4,314,1500\n2026-10-08T00:00:03Z,48,0.3,311,1498\n2026-10-08T00:00:04Z,53,0.2,309,1497\n";
test("CSV import retains values and round-trips through export", () => {
	const data = parseTelemetry(`\uFEFF${fixture}`, "samples.csv");
	assert.equal(data.samples.length, 5);
	assert.equal(data.imported, true);
	assert.deepEqual(parseTelemetry(telemetryCsv(data.samples), "export.csv").samples, data.samples);
	assert.equal(getMetrics(data.samples, 50)[0].value, 53);
	assert.equal(getMetrics(data.samples, 50)[0].accentColor, "amber");
});
test("invalid data is rejected without inventing missing channel values", () => {
	assert.throws(() => parseTelemetry("timestamp,temp\nbad,50", "bad.csv"), /有效时间/u);
	assert.throws(() => parseTelemetry("timestamp,temp\n2026-02-30T00:00:00Z,50", "bad.csv"), /有效时间/u);
	assert.throws(() => parseTelemetry("timestamp,temp\n100,50", "bad.csv"), /有效时间/u);
	assert.throws(() => parseTelemetry("timestamp,temp\n2026-10-08T00:00:00Z,NaN", "bad.csv"), /有限数值/u);
	assert.throws(() => parseTelemetry(`${fixture}2026-10-08T00:00:00Z,1,1,1,1\n`, "duplicate.csv"), /重复/u);
	assert.throws(() => parseTelemetry('timestamp,temp\n"2026-10-08T00:00:00Z,50', "bad.csv"), /引号/u);
	const data = parseTelemetry('{"timestamp":"2026-10-08T00:00:00Z","temperature":50}', "sample.log");
	assert.equal(getMetrics(data.samples, 75)[1].value, "—");
	assert.throws(() => parseTelemetry('{"timestamp":"2026-10-08T00:00:00Z","temperature":" "}', "empty.log"), /缺少/u);
});
test("spectrum identifies a known tone and rejects irregular sampling", () => {
	const samples = Array.from({ length: 64 }, (_, index) => ({
		timestamp: new Date(Date.UTC(2026, 9, 8) + index * 10).toISOString(),
		vibration: Math.sin((2 * Math.PI * 12.5 * index) / 100),
	}));
	const spectrum = getSpectrum(samples);
	const peak = spectrum.points.reduce((a, b) => (a.value > b.value ? a : b));
	assert.equal(peak.time, 12.5);
	assert.ok(Math.abs(peak.value - 1) < 0.000001);
	const nyquist = getSpectrum(samples.map((sample, index) => ({ ...sample, vibration: index % 2 ? -1 : 1 })));
	assert.equal(nyquist.points.at(-1)?.time, 50);
	assert.ok(Math.abs(nyquist.points.at(-1)!.value - 1) < 0.000001);
	samples[3].timestamp = new Date(Date.UTC(2026, 9, 8) + 35).toISOString();
	assert.equal(getSpectrum(samples).points.length, 0);
});
