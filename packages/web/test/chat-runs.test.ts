import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test, { type TestContext } from "node:test";
import { cancelChat, streamChat } from "../src/api.ts";
import { createChatRuns } from "../tools/chat-runs.ts";

const id = "22222222-2222-4222-8222-222222222222";
const chart = { version: 1 as const, id: "11111111-1111-4111-8111-111111111111" };

async function fixture(context: TestContext) {
	const runs = createChatRuns();
	let starts = 0;
	const server = createServer((request, response) => {
		if (request.method === "POST") {
			if (!runs.get(id)) {
				runs.create(id);
				starts++;
			}
			runs.get(id)!.attach(response);
		} else {
			const run = runs.get((request.url ?? "").slice("/api/chat/".length));
			if (!run) response.writeHead(404).end(JSON.stringify({ error: "生成任务已不可用" }));
			else if (request.method === "DELETE") {
				run.cancel();
				response.end("{}");
			} else run.attach(response);
		}
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const fetchToServer = globalThis.fetch;
	context.mock.method(globalThis, "fetch", (input: string | URL | Request, options?: RequestInit) =>
		fetchToServer(
			typeof input === "string" && input.startsWith("/") ? `http://127.0.0.1:${address.port}${input}` : input,
			options,
		),
	);
	context.after(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	return { runs, starts: () => starts };
}

test("refresh reconnects the same generation without duplicated text or charts", async (context) => {
	const f = await fixture(context);
	const controller = new AbortController();
	let firstSnapshot!: () => void;
	const ready = new Promise<void>((resolve) => {
		firstSnapshot = resolve;
	});
	const initial = streamChat(
		{ requestId: id },
		controller.signal,
		() => {},
		() => {},
		() => firstSnapshot(),
	);
	await ready;
	const run = f.runs.get(id)!;
	run.emit({ type: "delta", text: "刷新前" });
	run.emit({ type: "chart", chart });
	const disconnected = assert.rejects(initial, /abort/i);
	controller.abort();
	await disconnected;
	assert.equal(run.signal.aborted, false, "closing the browser must not cancel the model");
	run.emit({ type: "delta", text: "离线期间" });
	let text = "刷新前";
	let charts = [chart];
	let reconnected!: () => void;
	const attached = new Promise<void>((resolve) => {
		reconnected = resolve;
	});
	const resumed = streamChat(
		undefined,
		new AbortController().signal,
		(delta) => {
			text += delta;
		},
		(reference) => {
			charts.push(reference);
		},
		(snapshot, references) => {
			text = snapshot;
			charts = references;
			reconnected();
		},
		id,
	);
	await attached;
	assert.equal(text, "刷新前离线期间");
	assert.deepEqual(charts, [chart]);
	run.emit({ type: "delta", text: "刷新后" });
	run.emit({ type: "done" });
	assert.equal(await resumed, "done");
	assert.equal(text, "刷新前离线期间刷新后");
	assert.equal(f.starts(), 1);
	// A later reload must also recover replies that completed without a browser.
	let final = "";
	assert.equal(
		await streamChat(
			undefined,
			new AbortController().signal,
			() => {},
			() => {},
			(snapshot) => {
				final = snapshot;
			},
			id,
		),
		"done",
	);
	assert.equal(final, text);
});

test("explicit stop aborts the job and its cancelled status survives a reload", async (context) => {
	const f = await fixture(context);
	let attached!: () => void;
	const ready = new Promise<void>((resolve) => {
		attached = resolve;
	});
	const initial = streamChat(
		{ requestId: id },
		new AbortController().signal,
		() => {},
		() => {},
		attached,
	);
	await ready;
	await cancelChat(id);
	assert.equal(await initial, "cancelled");
	assert.equal(f.runs.get(id)!.signal.aborted, true);
	f.runs.get(id)!.emit({ type: "delta", text: "must not be added after cancellation" });
	let text = "";
	assert.equal(
		await streamChat(
			undefined,
			new AbortController().signal,
			() => {},
			() => {},
			(snapshot) => {
				text = snapshot;
			},
			id,
		),
		"cancelled",
	);
	assert.equal(text, "");
});

test("reconnection after a backend restart reports the missing job instead of starting another model request", async (context) => {
	const f = await fixture(context);
	await assert.rejects(
		streamChat(
			undefined,
			new AbortController().signal,
			() => {},
			() => {},
			() => {},
			id,
		),
		/不可用/,
	);
	assert.equal(f.starts(), 0);
});

test("reconnection keeps partial output and propagates the original generation failure", async (context) => {
	const f = await fixture(context);
	const run = f.runs.create(id);
	run.emit({ type: "delta", text: "已生成内容" });
	run.emit({ type: "chart", chart });
	run.emit({ type: "error", message: "模型响应超时" });
	let text = "";
	let charts: unknown[] = [];
	await assert.rejects(
		streamChat(
			undefined,
			new AbortController().signal,
			() => {},
			() => {},
			(snapshot, references) => {
				text = snapshot;
				charts = references;
			},
			id,
		),
		/模型响应超时/,
	);
	assert.equal(text, "已生成内容");
	assert.deepEqual(charts, [chart]);
});
