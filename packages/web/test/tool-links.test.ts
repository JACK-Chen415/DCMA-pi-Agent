import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type * as Mysql from "mysql2/promise";
import { closeDatabase } from "../../../dashboard/database/database.ts";
import { validateChartReference } from "../chart-contracts.ts";
import { updateToolSteps } from "../interaction-contracts.ts";
import { readChart } from "../tools/chart-files.ts";
import { createEvidenceArchive, readEvidence } from "../tools/evidence-files.ts";
import { createIndustrialServices, createIndustrialTools } from "../tools/index.ts";

test("knowledge search and source listing save evidence and retain their conversation steps", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-links-"));
	const requestId = randomUUID();
	const services = createIndustrialServices(directory);
	context.after(async () => {
		await services.monitoring.stop();
		await rm(directory, { recursive: true, force: true });
	});
	const tools = createIndustrialTools("real_data_01", services, createEvidenceArchive(directory, requestId));
	for (const name of ["list_fault_knowledge_sources", "search_fault_knowledge"]) {
		const tool = tools.find((item) => item.name === name)!;
		const params = name === "search_fault_knowledge" ? { code: "F0011", limit: 1 } : {};
		const response = await tool.execute(name, params as never, undefined, undefined, {} as never);
		assert.notEqual(response.isError, true, JSON.stringify(response.content));
		const evidenceId = (response.details as { evidenceId: string }).evidenceId;
		const record = (await readEvidence(directory, requestId)).records.find((item) => item.id === evidenceId)!;
		assert.equal(record.tool, name);
		const steps = updateToolSteps([], { type: "tool_end", callId: name, tool: name, ok: true, evidenceId });
		assert.equal(steps[0]?.evidenceId, record.id);
		assert.equal(steps[0]?.status, "done");
	}
});

test("streamed events beyond 20000 rows create a chart from the same evidence without querying again", async (context) => {
	Object.assign(process.env, {
		MYSQL_HOST: "test.invalid",
		MYSQL_USER: "test",
		MYSQL_PASSWORD: "test",
		MYSQL_DATABASE: "dcma",
	});
	const mysql = createRequire(new URL("../../../dashboard/database/database.ts", import.meta.url))(
		"mysql2/promise",
	) as typeof Mysql;
	const pool = mysql.createPool({});
	const directory = await mkdtemp(join(tmpdir(), "dcma-links-"));
	const requestId = randomUUID();
	const services = createIndustrialServices(directory);
	context.after(async () => {
		await services.monitoring.stop();
		await closeDatabase();
		await pool.end();
		await rm(directory, { recursive: true, force: true });
	});
	const from = "2026-10-20T00:00:00.000Z",
		to = "2026-10-27T00:00:00.000Z";
	const fields = ["id", "timestamp", "device_name", "inverter_name", "fault_code", "alarm_code"];
	const count = 30002;
	let reads = 0;
	const connection = {
		connection: {
			query(options: { sql: string }) {
				reads++;
				assert.doesNotMatch(options.sql, /LIMIT 20001/);
				return Object.assign(new EventEmitter(), {
					stream: () =>
						Readable.from(
							(function* () {
								for (let index = 0; index < count; index++)
									yield {
										id: index,
										timestamp: String(Date.parse(from) + index * 4000),
										fault_code: index >= 100 && index < 20100 ? "F1" : "0",
										alarm_code: index >= 22000 ? "A1" : "0",
									};
							})(),
						),
				});
			},
		},
		async execute() {
			return [
				fields.map((name) => ({
					TABLE_SCHEMA: "dcma",
					TABLE_NAME: "real_data_01",
					COLUMN_NAME: name,
					DATA_TYPE: "varchar",
					COLUMN_KEY: "",
					COLUMN_COMMENT: "",
				})),
			];
		},
		async query(options: { sql: string }) {
			if (options.sql.includes("SELECT DISTINCT")) return [[{ device_name: "test", inverter_name: "test" }]];
			if (options.sql.includes("invalid_times")) return [[{ invalid_times: 0, excluded: 0 }]];
			return [[]];
		},
		destroy() {},
		release() {},
	};
	context.mock.method(Object.getPrototypeOf(pool), "getConnection", async () => connection);
	const tools = createIndustrialTools("real_data_01", services, createEvidenceArchive(directory, requestId));
	const query = await tools
		.find((tool) => tool.name === "get_code_events")!
		.execute("query", { from, to } as never, undefined, undefined, {} as never);
	assert.notEqual(query.isError, true, JSON.stringify(query.content));
	const evidenceId = (query.details as { evidenceId: string }).evidenceId;
	const response = await tools
		.find((tool) => tool.name === "create_analysis_chart")!
		.execute("chart", { evidenceId, kind: "bar" } as never, undefined, undefined, {} as never);
	assert.notEqual(response.isError, true, JSON.stringify(response.content));
	const reference = validateChartReference(
		response.details && "chart" in response.details ? response.details.chart : null,
	);
	assert.ok(reference);
	const chart = await readChart(directory, reference.id);
	assert.deepEqual(chart.rows, [
		["报警 A1", 1],
		["故障 F1", 1],
	]);
	assert.equal(chart.sourceRecords, count);
	assert.equal(chart.sources[0].from, from);
	assert.equal(chart.sources[0].to, to);
	assert.equal(chart.sources[0].firstSampleAt, from);
	assert.equal(chart.sources[0].lastSampleAt, new Date(Date.parse(from) + (count - 1) * 4000).toISOString());
	assert.equal(chart.evidenceId, evidenceId);
	assert.equal(reads, 1);
	assert.equal((await readEvidence(directory, requestId)).records.length, 2);
});
