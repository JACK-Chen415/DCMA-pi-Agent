import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createHarness, getToolResult } from "../../coding-agent/test/suite/harness.ts";
import { summarizeMetrics } from "../tools/analytics.ts";
import { createAnswerDelivery } from "../tools/answer.ts";
import { createIndustrialServices, createIndustrialTools } from "../tools/index.ts";
import { createEvidenceStore } from "../tools/runtime-files.ts";
import { createTextStream } from "../tools/text-stream.ts";
import { chartFixture } from "./chart-fixture.ts";

test("the real SDK rejects a ranking, accepts one correction and terminates on validated delivery", async () => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-answer-"));
	const services = createIndustrialServices(directory);
	const delivery = createAnswerDelivery();
	const summary = summarizeMetrics(chartFixture([38, 38, 38]).window, ["motor_temp"]);
	const record = createEvidenceStore().add(
		"summarize_metrics",
		{},
		{ ...summary, metrics: summary.metrics.map((item) => ({ ...item, unit: "℃" })) },
	);
	const submit = createIndustrialTools("real_data_01", services, undefined, delivery).find(
		(tool) => tool.name === "submit_analysis",
	)!;
	const harness = await createHarness({
		tools: [
			{
				name: "summarize_metrics",
				label: "fixture",
				description: "fixture",
				parameters: Type.Object({}),
				execute: async () => {
					delivery.record(record);
					return {
						content: [
							{ type: "text", text: JSON.stringify({ ok: true, evidenceId: record.id, result: record.result }) },
						],
						details: {},
					};
				},
			},
			{
				...submit,
				execute: (id, params, signal, onUpdate) =>
					submit.execute(id, params as never, signal, onUpdate, {} as never),
			},
		],
	});
	let draft = "";
	const stream = createTextStream();
	const unsubscribe = harness.session.subscribe((event) => {
		if (event.type === "tool_execution_start") delivery.start(event.toolName);
		draft += stream(event);
	});
	try {
		harness.setResponses([
			fauxAssistantMessage(
				[{ type: "text", text: "温度最平稳，电流偏小。" }, fauxToolCall("summarize_metrics", {})],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("submit_analysis", {
					format: "brief",
					claims: [{ kind: "stability_ranking", evidenceId: record.id }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("submit_analysis", {
					format: "brief",
					claims: [{ kind: "metric_summary", evidenceId: record.id }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("这段自由结论不应被请求。"),
		]);
		await harness.session.prompt("帮我看看电机最近运行得怎么样。");
		const submissions = harness
			.eventsOfType("tool_execution_end")
			.filter((event) => event.toolName === "submit_analysis");
		assert.equal(submissions.length, 2);
		assert.equal(submissions[0].isError, true);
		assert.equal(submissions[1].isError, false);
		assert.match(JSON.stringify(submissions[0].result), /统一比较方法/);
		assert.equal(harness.getPendingResponseCount(), 1);
		assert.equal(getToolResult(harness, "submit_analysis").isError, false);
		assert.match(draft, /温度最平稳/);
		const answer = delivery.finish(draft);
		assert.match(answer, /平均38，范围38～38/);
		assert.doesNotMatch(answer, /温度最平稳|电流偏小|自由结论/);
	} finally {
		unsubscribe();
		harness.cleanup();
		await services.monitoring.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
