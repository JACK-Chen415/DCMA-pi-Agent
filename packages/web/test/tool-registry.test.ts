import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Check } from "typebox/value";
import { createIndustrialServices, createIndustrialTools } from "../tools/index.ts";

test("registered catalog schema supports optional table filtering without accepting arbitrary sources", async () => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-registry-"));
	const services = createIndustrialServices(directory);
	try {
		const tools = createIndustrialTools("real_data_01", services);
		assert.equal(tools.length, 20);
		assert.equal(new Set(tools.map((tool) => tool.name)).size, 20);
		const drawing = tools.find((tool) => tool.name === "create_analysis_chart");
		assert.ok(drawing);
		assert.ok(
			Check(drawing.parameters, {
				evidenceId: "11111111-1111-4111-8111-111111111111",
				kind: "line",
				metrics: ["motor_temp"],
			}),
		);
		assert.ok(!Check(drawing.parameters, { evidenceId: "x", kind: "line", points: [1, 2, 3] }));
		const catalog = tools.find((tool) => tool.name === "list_industrial_tables");
		assert.ok(catalog);
		assert.ok(Check(catalog.parameters, {}));
		assert.ok(Check(catalog.parameters, { table: "real_data_01", refresh: false }));
		assert.ok(!Check(catalog.parameters, { table: "private_table" }));
		assert.ok(!Check(catalog.parameters, { schema: "other_database" }));
		const statistics = tools.find((tool) => tool.name === "summarize_metrics");
		assert.ok(statistics);
		assert.ok(
			Check(statistics.parameters, { from: "2026-10-22T00:00:00.000+08:00", to: "2026-10-22T00:03:00.000+08:00" }),
		);
	} finally {
		await services.monitoring.stop();
		await rm(directory, { recursive: true, force: true });
	}
});

test("knowledge tool reports invalid filters as failures and permits a corrected exact lookup", async () => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-filters-"));
	const services = createIndustrialServices(directory);
	try {
		const tool = createIndustrialTools("real_data_01", services).find(
			(item) => item.name === "search_fault_knowledge",
		)!;
		for (const filters of [{ kind: "alarm" }, { source: "S120_故障手册.pdf" }]) {
			const result = await tool.execute(
				"invalid",
				{ code: "A07089", ...filters },
				new AbortController().signal,
				undefined,
				{} as never,
			);
			assert.equal(result.isError, true);
			assert.equal(result.details.evidenceId, "");
			assert.match(JSON.stringify(result.content), /允许值.*本次未执行检索/);
		}
		const result = await tool.execute(
			"corrected",
			{ code: "A07089", kind: "drive_fault_manual", source: "s120-fault-manual" },
			new AbortController().signal,
			undefined,
			{} as never,
		);
		assert.notEqual(result.isError, true);
		const content = result.content[0];
		assert.equal(content.type, "text");
		if (content.type !== "text") throw new Error("expected text");
		assert.equal(JSON.parse(content.text).result.count, 1);
	} finally {
		await services.monitoring.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
