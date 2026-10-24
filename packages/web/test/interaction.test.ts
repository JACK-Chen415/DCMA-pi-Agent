import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DashboardTable } from "../../../dashboard/database/dashboard-types.ts";
import { type EvidenceRecord, updateToolSteps, validateToolSteps } from "../interaction-contracts.ts";
import { streamChat } from "../src/api.ts";
import { validateConversations } from "../src/conversation-state.ts";
import { summarizeMetrics } from "../tools/analytics.ts";
import { createChatRuns } from "../tools/chat-runs.ts";
import { createChatTimeout } from "../tools/chat-timeout.ts";
import { createEvidenceArchive, readEvidence } from "../tools/evidence-files.ts";
import { handleToolHttp } from "../tools/http.ts";
import { createIndustrialServices, createIndustrialTools } from "../tools/index.ts";
import { chartFixture } from "./chart-fixture.ts";

const id = "11111111-1111-4111-8111-111111111111";
const record: EvidenceRecord = {
	id,
	tool: "summarize_metrics",
	createdAt: "2026-10-22T00:00:00.000Z",
	input: { metrics: ["motor_temp"] },
	result: { records: 3, mean: 0 },
};

test("progress survives chunked stream, reconnect and conversation persistence without retaining raw stream data", async (context) => {
	const events = [
		{ type: "snapshot", text: "", charts: [], steps: [] },
		{ type: "tool_start", tool: "summarize_metrics", callId: "call-1", parameters: { secret: "DO_NOT_RETAIN" } },
		{ type: "tool_end", tool: "summarize_metrics", callId: "call-1", ok: true, durationMs: 25, evidenceId: id },
		{ type: "done" },
	];
	context.mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						const bytes = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n"));
						for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7));
						controller.close();
					},
				}),
			),
	);
	let steps = validateToolSteps([]);
	await streamChat(
		{},
		new AbortController().signal,
		() => {},
		undefined,
		undefined,
		undefined,
		(value) => {
			steps = value;
		},
	);
	assert.equal(steps.length, 1);
	assert.equal(steps[0].status, "done");
	assert.equal(steps[0].evidenceId, id);
	assert.ok(!JSON.stringify(steps).includes("DO_NOT_RETAIN"));
	const saved = {
		version: 1,
		revision: 1,
		deviceId: "real_data_01",
		activeId: "c",
		conversations: [
			{
				id: "c",
				title: "test",
				time: record.createdAt,
				deviceId: "real_data_01",
				messages: [
					{ id, role: "assistant", content: "answer", timestamp: record.createdAt, status: "done", steps },
				],
			},
		],
	};
	assert.deepEqual(validateConversations(saved), saved);
	assert.equal(updateToolSteps(steps, { type: "tool_start", tool: "forged", callId: "bad" }), steps);
	assert.throws(() =>
		validateConversations({
			...saved,
			conversations: [
				{
					...saved.conversations[0],
					messages: [
						{ ...saved.conversations[0].messages[0], steps: [{ callId: "x", tool: "forged", status: "done" }] },
					],
				},
			],
		}),
	);
	const run = createChatRuns().create(id);
	run.emit(events[1]);
	run.emit(events[2]);
	run.emit({ type: "done" });
	// The same snapshot is what streamChat consumes after a browser reload.
	const server = createServer((_request, response) => run.attach(response));
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	context.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	// Use the real fetch rather than the chunk fixture for the HTTP snapshot.
	context.mock.restoreAll();
	const snapshot = (await (await fetch(`http://127.0.0.1:${address.port}`)).text()).split("\n")[0];
	assert.deepEqual(JSON.parse(snapshot).steps, steps);
});

test("evidence archive and HTTP preserve exact results across instances and reject malformed paths or writes", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-evidence-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const save = createEvidenceArchive(directory, id);
	await save(record);
	const second = {
		...record,
		id: "22222222-2222-4222-8222-222222222222",
		tool: "search_maintenance_knowledge",
		result: { matches: [{ excerpt: "参考原文", source: { title: "测试手册", locator: "第3页", revision: "v1" } }] },
	};
	await save(second);
	assert.deepEqual((await readEvidence(directory, id)).records, [record, second]);
	await assert.rejects(readEvidence(directory, "../profiles.json"));
	const services = createIndustrialServices(directory);
	const server = createServer((request, response) => {
		void handleToolHttp(request, response, new URL(request.url ?? "/", "http://localhost"), services);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	context.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/tools/evidence/${id}.json`;
	assert.deepEqual(await (await fetch(url)).json(), { version: 1, requestId: id, records: [record, second] });
	assert.equal((await fetch(url, { method: "POST" })).status, 405);
	assert.equal((await fetch(url.replace(id, "bad"))).status, 404);
	const file = join(directory, "evidence", `${id}.json`);
	const previous = await readFile(file, "utf8");
	await assert.rejects(
		save({ ...record, id: "33333333-3333-4333-8333-333333333333", result: "x".repeat(2 * 1024 * 1024) }),
		/超过2MiB/,
	);
	assert.equal(await readFile(file, "utf8"), previous);
	await writeFile(file, JSON.stringify({ version: 1, requestId: second.id, records: [record] }));
	assert.equal((await fetch(url)).status, 404);
});

test("provider waiting time does not consume the tool execution budget", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-budget-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const services = createIndustrialServices(directory);
	let now = Date.now();
	context.mock.method(Date, "now", () => now);
	const tools = createIndustrialTools("real_data_01", services);
	now += 120001;
	const tool = tools.find((item) => item.name === "get_device_profile")!;
	const result = await tool.execute("first", {}, new AbortController().signal, undefined, {} as never);
	assert.equal(JSON.parse(String(result.content[0].type === "text" ? result.content[0].text : "")).ok, true);
	const original = services.knowledge.getDeviceProfile;
	context.mock.method(services.knowledge, "getDeviceProfile", async (table: DashboardTable) => {
		now += 90000;
		return original(table);
	});
	await tool.execute("second", {}, new AbortController().signal, undefined, {} as never);
	const exhausted = await tool.execute("third", {}, new AbortController().signal, undefined, {} as never);
	assert.equal(exhausted.isError, true);
	assert.match(JSON.stringify(exhausted.content), /预算/);
});

test("silence and absolute timeout are distinct, and disposal clears both timers", (context) => {
	context.mock.timers.enable({ apis: ["setTimeout"] });
	const failures: string[] = [];
	const guard = createChatTimeout((message) => failures.push(message), 100, 300);
	context.mock.timers.tick(80);
	guard.touch("统计指标");
	context.mock.timers.tick(80);
	assert.equal(failures.length, 0);
	context.mock.timers.tick(21);
	assert.match(failures[0], /统计指标/);
	context.mock.timers.tick(1000);
	assert.equal(failures.length, 1);
	const other = createChatTimeout((message) => failures.push(message), 100, 300);
	for (let i = 0; i < 3; i++) {
		context.mock.timers.tick(90);
		other.touch();
	}
	context.mock.timers.tick(30);
	assert.equal(failures.length, 2);
	assert.match(failures[1], /总时限/);
	const disposed = createChatTimeout((message) => failures.push(message), 100, 300);
	disposed.dispose();
	context.mock.timers.tick(1000);
	assert.equal(failures.length, 2);
});

test("strict threshold count excludes equality and missing values, preserves zero and negatives", () => {
	const window = chartFixture([-2, 0, 50, 51, null]).window;
	const result = summarizeMetrics(window, ["motor_temp"], undefined, {
		metric: "motor_temp",
		operator: "gt",
		threshold: 50,
	});
	assert.equal(result.condition?.matched, 1);
	assert.equal(result.condition?.valid, 4);
	assert.equal(result.condition?.missing, 1);
	assert.equal(result.condition?.notMatched, 3);
	assert.equal(result.metrics[0].min, -2);
	assert.equal(
		summarizeMetrics(window, ["motor_temp"], undefined, { metric: "motor_temp", operator: "lt", threshold: 0 })
			.condition?.matched,
		1,
	);
	assert.throws(() =>
		summarizeMetrics(window, ["motor_temp"], undefined, { metric: "current_actual", operator: "gt", threshold: 50 }),
	);
	assert.throws(() =>
		summarizeMetrics(window, ["motor_temp"], undefined, {
			metric: "motor_temp",
			operator: "gt",
			threshold: Number.NaN,
		}),
	);
	const empty = { ...window, records: [] };
	assert.equal(
		summarizeMetrics(empty, ["motor_temp"], undefined, { metric: "motor_temp", operator: "gt", threshold: 50 })
			.condition?.matched,
		0,
	);
});
