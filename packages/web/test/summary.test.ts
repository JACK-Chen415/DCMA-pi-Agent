import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type * as Mysql from "mysql2/promise";
import { fieldLabels } from "../../../dashboard/database/dashboard-types.ts";
import { closeDatabase, readMetricAggregates } from "../../../dashboard/database/database.ts";
import { createChartOptions } from "../src/chart-options.ts";
import { renderChartSvg } from "../src/chart-render.ts";
import { evidenceSummary } from "../src/evidence.ts";
import { readChart } from "../tools/chart-files.ts";
import { createEvidenceArchive, readEvidence } from "../tools/evidence-files.ts";
import { createIndustrialServices, createIndustrialTools } from "../tools/index.ts";
import { loadMetricSummary, type MetricSummary } from "../tools/summary.ts";

test("week statistics cover all rows, preserve empty buckets/extrema, and charts reuse archived evidence", async (context) => {
	process.env.MYSQL_HOST = "test.invalid";
	process.env.MYSQL_USER = "test";
	process.env.MYSQL_PASSWORD = "test";
	process.env.MYSQL_DATABASE = "dcma";
	const mysql = createRequire(new URL("../../../dashboard/database/database.ts", import.meta.url))(
		"mysql2/promise",
	) as typeof Mysql;
	const pool = mysql.createPool({});
	const directory = await mkdtemp(join(tmpdir(), "dcma-week-"));
	await writeFile(
		join(directory, "profiles.json"),
		JSON.stringify({
			profiles: [
				{
					table: "real_data_01",
					manufacturer: null,
					model: null,
					version: null,
					source: "synthetic confirmed units",
					units: { motor_temp: "°C" },
				},
			],
		}),
	);
	const requestId = "11111111-1111-4111-8111-111111111111";
	const from = "2026-10-20T00:00:00.000Z",
		to = "2026-10-27T00:00:00.000Z";
	const first = Date.parse(from),
		last = Date.parse(to);
	const mean = (20000 * 2 + 10001 * 10) / 30001;
	let empty = false,
		reads = 0;
	const statements: string[] = [];
	const connection = {
		async query(options: { sql: string }) {
			statements.push(options.sql);
			if (options.sql.includes("SELECT DISTINCT"))
				return [[{ device_name: "synthetic", inverter_name: "synthetic" }]];
			if (options.sql.includes("invalid_times")) return [[{ invalid_times: 2, excluded: 3 }]];
			assert.match(options.sql, /^(START TRANSACTION READ ONLY|COMMIT)$/);
			return [[]];
		},
		async execute(options: { sql: string }, values: unknown[]) {
			statements.push(options.sql);
			if (options.sql.includes("information_schema.COLUMNS"))
				return [
					Object.keys(fieldLabels).map((name) => ({
						TABLE_SCHEMA: "dcma",
						TABLE_NAME: "real_data_01",
						COLUMN_NAME: name,
						DATA_TYPE: "float",
						COLUMN_KEY: "",
						COLUMN_COMMENT: "",
					})),
				];
			if (options.sql.includes("WITH ROLLUP")) {
				reads++;
				assert.match(options.sql, /STDDEV_POP\(m0\)/);
				assert.doesNotMatch(options.sql, /LIMIT 20001/);
				assert.deepEqual(values.slice(-2), [first, last]);
				if (empty) return [[]];
				return [
					[
						{ bucket: 0, records: 20001, m0_count: 20000, m0_mean: 2, m0_min: 0, m0_max: 4 },
						{ bucket: 167, records: 10001, m0_count: 10001, m0_mean: 10, m0_min: 8, m0_max: 12 },
						{
							bucket: null,
							records: 30002,
							first_at: first,
							last_at: last,
							m0_count: 30001,
							m0_zeros: 1,
							m0_mean: mean,
							m0_stddev: 4,
							m0_min: 0,
							m0_max: 12,
							matched: 5000,
						},
					],
				];
			}
			if (options.sql.includes("HAVING COUNT(*) = 1")) return [[{ m0_first: first, m0_last: last }]];
			assert.match(options.sql, /__collection_ms IN \(\?,\?\)/);
			assert.deepEqual(values, [first, last]);
			return [
				[
					{ __collection_ms: first, m0: 0 },
					{ __collection_ms: last, m0: 12 },
				],
			];
		},
		destroy() {},
		release() {},
	};
	context.mock.method(Object.getPrototypeOf(pool), "getConnection", async () => connection);
	const services = createIndustrialServices(directory);
	context.after(async () => {
		await services.monitoring.stop();
		await closeDatabase();
		await pool.end();
		await rm(directory, { recursive: true, force: true });
	});
	const tools = createIndustrialTools("real_data_01", services, createEvidenceArchive(directory, requestId));
	const invoke = async (name: string, input: unknown) => {
		const response = await tools
			.find((tool) => tool.name === name)!
			.execute("fixture", input as never, undefined, undefined, {} as never);
		return JSON.parse(
			response.content
				.filter((item) => item.type === "text")
				.map((item) => item.text)
				.join(""),
		) as {
			ok: boolean;
			evidenceId: string;
			result: MetricSummary & { chart: { id: string } };
		};
	};
	const input = {
		from,
		to,
		metrics: ["motor_temp"],
		condition: { metric: "motor_temp", operator: "gt", threshold: 8 },
	};
	const response = await invoke("summarize_metrics", input);
	assert.equal(response.ok, true);
	assert.equal(response.result.records, 30002);
	assert.equal(response.result.metrics[0].mean, mean);
	assert.equal((response.result.metrics[0] as unknown as { unit: string }).unit, "°C");
	assert.equal(response.result.unitsVerified, true);
	assert.notEqual(response.result.metrics[0].mean, (2 + 10) / 2);
	assert.equal(response.result.metrics[0].missing, 1);
	assert.equal(response.result.metrics[0].zeros, 1);
	assert.deepEqual(response.result.metrics[0].last, { at: to, value: 12 });
	assert.deepEqual(response.result.condition, {
		...input.condition,
		matched: 5000,
		valid: 30001,
		missing: 1,
		notMatched: 25001,
		meaning: "采样点数，不是连续事件次数",
	});
	assert.equal(response.result.bucketSeconds, 3600);
	assert.equal(response.result.trend.rows.length, 168);
	assert.deepEqual(response.result.trend.rows[1].slice(1), [0, 0, null, null, null]);
	assert.equal((await invoke("summarize_metrics", input)).ok, true);
	assert.equal(reads, 1);
	const drawing = await invoke("create_analysis_chart", {
		evidenceId: response.evidenceId,
		kind: "line",
		metrics: ["motor_temp"],
	});
	assert.equal(drawing.ok, true);
	assert.equal(reads, 1);
	const chart = await readChart(directory, drawing.result.chart.id);
	assert.equal(chart.sourceRecords, 30002);
	assert.equal(chart.sources[0].from, from);
	assert.equal(chart.sources[0].to, to);
	assert.deepEqual(chart.rows[167].slice(1), [10, 8, 12]);
	assert.equal(chart.series[0].unit, "°C");
	assert.deepEqual(chart.rows[1].slice(1), [null, null, null]);
	const series = createChartOptions(chart, 1000).series as { connectNulls: boolean; data: unknown[] }[];
	assert.equal(series.length, 3);
	assert.ok(series.every((entry) => entry.connectNulls === false));
	assert.match(renderChartSvg(chart), /<svg/);
	const bundle = await readEvidence(directory, requestId);
	const saved = bundle.records.find((record) => record.id === response.evidenceId)!;
	assert.deepEqual(saved.result, response.result);
	assert.match(evidenceSummary(saved).join("\n"), /完整请求时段.*每1小时/);
	assert.equal(
		(
			await invoke("create_analysis_chart", {
				evidenceId: response.evidenceId,
				kind: "scatter",
				metrics: ["motor_temp"],
				xMetric: "current_actual",
			})
		).ok,
		false,
	);
	assert.equal(
		(
			await invoke("create_analysis_chart", {
				evidenceId: response.evidenceId,
				kind: "line",
				metrics: ["motor_temp"],
				bucketSeconds: 60,
			})
		).ok,
		false,
	);
	const comparison = await invoke("compare_metric_windows", {
		a: { from, to },
		b: { from, to },
		metrics: ["motor_temp"],
	});
	assert.equal(comparison.ok, true);
	assert.equal((comparison.result as unknown as { a: { metrics: { unit: string }[] } }).a.metrics[0].unit, "°C");
	assert.equal("trend" in (comparison.result as unknown as { a: object }).a, false);
	const beforeDrawing = reads;
	const compared = await invoke("create_analysis_chart", {
		evidenceId: comparison.evidenceId,
		kind: "bar",
		metrics: ["motor_temp"],
	});
	assert.equal(compared.ok, true);
	const comparisonChart = await readChart(directory, compared.result.chart.id);
	assert.deepEqual(comparisonChart.rows, [
		["A", mean],
		["B", mean],
	]);
	assert.equal(reads, beforeDrawing);
	empty = true;
	const result = await loadMetricSummary(
		{ table: "real_data_01", from, to },
		["motor_temp"],
		AbortSignal.timeout(1000),
	);
	assert.equal(result.records, 0);
	assert.equal(result.metrics[0].mean, null);
	assert.equal(result.metrics[0].min, null);
	assert.equal(result.metrics[0].first, null);
	assert.ok(result.trend.rows.every((row) => row[3] === null));
	await assert.rejects(
		readMetricAggregates({ table: "real_data_01", from, to, metrics: ["injected" as never], bucketSeconds: 3600 }),
		/INVALID_AGGREGATION/,
	);
	await assert.rejects(loadMetricSummary({ table: "real_data_01", from, to }, ["motor_temp"], AbortSignal.abort()));
	assert.ok(statements.every((sql) => /^(SELECT|START TRANSACTION READ ONLY|COMMIT)/.test(sql)));
});
