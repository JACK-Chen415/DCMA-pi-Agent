import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { type ConversationState, validateConversations } from "../src/conversation-state.ts";
import { conversationBackupKey, createConversationStorage } from "../src/conversation-storage.ts";
import { createConversationStore, handleConversationHttp } from "../tools/conversation-store.ts";

const empty: ConversationState = { conversations: [], activeId: null, deviceId: "real_data_01" };
const legacy: ConversationState = {
	deviceId: "real_data_02",
	activeId: "conversation-1",
	conversations: [
		{
			id: "conversation-1",
			title: "温度趋势",
			time: "2026-10-22T01:00:00.000Z",
			deviceId: "real_data_02",
			messages: [
				{
					id: "question",
					role: "user",
					content: "查看温度",
					timestamp: "2026-10-22T01:00:00.000Z",
					status: "done",
				},
				{
					id: "answer",
					role: "assistant",
					content: "分析结果",
					timestamp: "2026-10-22T01:00:00.000Z",
					status: "done",
					charts: [{ version: 1, id: "11111111-1111-4111-8111-111111111111" }],
				},
			],
		},
	],
};

async function fixture(context: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), "dcma-conversations-"));
	const store = createConversationStore(directory);
	let currentStore = store;
	const server = createServer((request, response) => {
		void handleConversationHttp(request, response, currentStore);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	const realFetch = globalThis.fetch;
	const requests: string[] = [];
	context.mock.method(globalThis, "fetch", (input: string | URL | Request, options?: RequestInit) => {
		requests.push(options?.method ?? "GET");
		return realFetch(typeof input === "string" && input.startsWith("/") ? `${base}${input}` : input, options);
	});
	const cache = new Map<string, string>();
	const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => cache.get(key) ?? null,
			setItem: (key: string, value: string) => {
				cache.set(key, value);
			},
		},
	});
	const errors: string[] = [];
	const clients: ReturnType<typeof createConversationStorage>[] = [];
	const client = () => {
		const storage = createConversationStorage((message) => errors.push(message));
		clients.push(storage);
		return storage;
	};
	context.after(async () => {
		for (const storage of clients) storage.dispose();
		if (previous) Object.defineProperty(globalThis, "localStorage", previous);
		else Reflect.deleteProperty(globalThis, "localStorage");
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		const resolved = join(tmpdir(), directory.split(/[\\/]/).at(-1)!);
		assert.equal(directory, resolved);
		await rm(directory, { recursive: true, force: true });
	});
	return {
		directory,
		store,
		client,
		cache,
		errors,
		requests,
		base,
		restart: () => {
			currentStore = createConversationStore(directory);
		},
	};
}

test("migrates browser history, restores after backend restart without browser data, and persists rename/delete", async (context) => {
	const f = await fixture(context);
	const browser = f.client();
	const migrated = await browser.load(legacy);
	assert.deepEqual(migrated, legacy);
	browser.update(migrated, false);
	await browser.flush();
	assert.deepEqual((await f.store.read())?.conversations, legacy.conversations);
	assert.deepEqual(await readdir(join(f.directory, "conversations")), ["state.json"]);
	browser.dispose();
	f.cache.clear();
	f.restart();
	const reopened = f.client();
	assert.deepEqual(await reopened.load(empty), legacy);
	const renamed = structuredClone(legacy);
	renamed.conversations[0].title = "重命名后的会话";
	reopened.update(renamed, false);
	await reopened.flush();
	assert.equal((await f.store.read())?.conversations[0].title, "重命名后的会话");
	reopened.update(empty, false);
	await reopened.flush();
	reopened.dispose();
	f.cache.clear();
	assert.deepEqual(
		await f.client().load(legacy),
		empty,
		"old browser histories must not resurrect deleted conversations",
	);
	const other = createConversationStore(join(f.directory, "other-developer"));
	assert.equal(await other.read(), null, "independent runtime directories must not share conversations");
});

test("checkpoints continuous streaming and preserves the pending reply for reconnection", async (context) => {
	const f = await fixture(context);
	const browser = f.client();
	await browser.load(empty);
	const partial = structuredClone(legacy);
	partial.conversations[0].messages[1].status = "streaming";
	browser.update(partial, true);
	await browser.flush();
	partial.conversations[0].messages[1].content = "仍在不断生成的新内容";
	browser.update(structuredClone(partial), true);
	const before = f.requests.length;
	await new Promise((resolve) => setTimeout(resolve, 1200));
	assert.ok(f.requests.length > before, "continuous streaming must save periodically without an explicit flush");
	assert.equal((await f.store.read())?.conversations[0].messages[1].content, "仍在不断生成的新内容");
	browser.dispose();
	f.cache.clear();
	const restored = await f.client().load(empty);
	assert.equal(restored.conversations[0].messages[1].status, "streaming");
	assert.deepEqual(restored.conversations[0].messages[1].charts, legacy.conversations[0].messages[1].charts);
});

test("checkpoint saves the reply identity before starting generation and rejects failed saves", async (context) => {
	const f = await fixture(context);
	const browser = f.client();
	await browser.load(empty);
	const pending = structuredClone(legacy);
	pending.conversations[0].messages[1].status = "streaming";
	await browser.checkpoint(pending);
	assert.deepEqual((await f.store.read())?.conversations, pending.conversations);
	context.mock.method(globalThis, "fetch", () => Promise.reject(new Error("offline")));
	await assert.rejects(browser.checkpoint(empty), /暂未发起生成/);
	assert.deepEqual((await f.store.read())?.conversations, pending.conversations);
});

test("recovers pending page-close cache only at its matching backend revision", async (context) => {
	const f = await fixture(context);
	const saved = await f.store.save({ ...legacy, version: 1, revision: 0 });
	assert.ok(saved);
	const pending = structuredClone(saved);
	pending.conversations[0].messages[1].content = "关闭页面前尚未上传的内容";
	pending.conversations[0].messages[1].status = "streaming";
	f.cache.set(conversationBackupKey, JSON.stringify(pending));
	assert.equal(
		(await f.client().load(empty)).conversations[0].messages[1].content,
		pending.conversations[0].messages[1].content,
	);
	await f.store.save({ ...empty, version: 1, revision: saved.revision });
	assert.deepEqual(
		await f.client().load(legacy),
		empty,
		"stale page-close caches must not overwrite a newer backend revision",
	);
});

test("failed reads and damaged files never trigger migration or overwrite the original", async (context) => {
	const f = await fixture(context);
	await f.store.save({ ...legacy, version: 1, revision: 0 });
	const file = join(f.directory, "conversations", "state.json");
	await writeFile(file, "{damaged but recoverable");
	const browser = f.client();
	await assert.rejects(browser.load(legacy), /读取失败/);
	browser.update(empty, false);
	await browser.flush();
	assert.deepEqual(f.requests, ["GET"]);
	await assert.rejects(f.store.save({ ...empty, version: 1, revision: 0 }));
	assert.equal(await readFile(file, "utf8"), "{damaged but recoverable");
});

test("stale tabs and simultaneous writes cannot overwrite a newer saved history", async (context) => {
	const f = await fixture(context);
	await f.store.save({ ...legacy, version: 1, revision: 0 });
	const first = f.client();
	const stale = f.client();
	await first.load(empty);
	await stale.load(empty);
	first.update(empty, false);
	await first.flush();
	stale.update(legacy, false);
	await stale.flush();
	// Change the stale state so it attempts a save rather than matching its initial snapshot.
	stale.update({ ...legacy, activeId: null }, false);
	await stale.flush();
	assert.match(f.errors.at(-1) ?? "", /其他页面更新/);
	const before = f.requests.length;
	await stale.flush();
	assert.equal(f.requests.length, before, "conflicted tabs must stop automatic writes");
	const state = await f.store.read();
	assert.ok(state);
	assert.deepEqual(state.conversations, []);
	const results = await Promise.all([
		f.store.save({ ...state, deviceId: "real_data_02" }),
		f.store.save({ ...state, deviceId: "real_data_03" }),
	]);
	assert.equal(results.filter(Boolean).length, 1);
});

test("HTTP rejects malformed data, missing write headers, and unsupported methods without changing history", async (context) => {
	const f = await fixture(context);
	await f.store.save({ ...legacy, version: 1, revision: 0 });
	const original = await f.store.read();
	const headers = { "Content-Type": "application/json", "X-DCMA-Client": "web" };
	assert.equal((await fetch(`${f.base}/api/conversations`, { method: "PUT", headers, body: "{}" })).status, 400);
	assert.equal(
		(await fetch(`${f.base}/api/conversations`, { method: "PUT", body: JSON.stringify(original) })).status,
		403,
	);
	assert.equal((await fetch(`${f.base}/api/conversations`, { method: "DELETE" })).status, 405);
	assert.deepEqual(await f.store.read(), original);
	assert.throws(() => validateConversations({ ...original, activeId: "missing" }));
	assert.throws(() => validateConversations({ ...original, conversations: Array(51).fill(legacy.conversations[0]) }));
	assert.throws(() => validateConversations({ ...original, revision: -1 }));
});

test("a failed save keeps current history and retries successfully without browser storage", async (context) => {
	const f = await fixture(context);
	const fetchToServer = globalThis.fetch;
	let failNextSave = true;
	context.mock.method(globalThis, "fetch", (input: string | URL | Request, options?: RequestInit) => {
		if (options?.method === "PUT" && failNextSave) {
			failNextSave = false;
			return Promise.reject(new Error("temporary backend failure"));
		}
		return fetchToServer(input, options);
	});
	context.mock.method(localStorage, "getItem", () => {
		throw new Error("browser storage unavailable");
	});
	context.mock.method(localStorage, "setItem", () => {
		throw new Error("browser storage unavailable");
	});
	const browser = f.client();
	assert.deepEqual(await browser.load(legacy), legacy);
	browser.update(legacy, false);
	await browser.flush();
	assert.match(f.errors.at(-1) ?? "", /temporary backend failure/);
	assert.equal(await f.store.read(), null);
	await browser.flush();
	assert.deepEqual((await f.store.read())?.conversations, legacy.conversations);
	assert.equal(f.errors.at(-1), "");
});
