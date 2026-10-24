import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { exportStatusEvent, saveExportFile } from "../src/download.ts";
import { handleExportHttp } from "../tools/exports.ts";

async function fixture(
	context: test.TestContext,
	choose?: (name: string, directory: string) => Promise<string | null>,
) {
	const parent = resolve(".artifacts");
	await mkdir(parent, { recursive: true });
	const directory = await mkdtemp(join(parent, "export-test-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const server = createServer((request, response) => {
		void handleExportHttp(request, response, (name) =>
			choose ? choose(name, directory) : Promise.resolve(join(directory, name)),
		);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	context.after(async () => {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
	});
	return { directory, url: `http://127.0.0.1:${address.port}/api/exports` };
}
const headers = (name: string, type = "text/markdown;charset=utf-8") => ({
	"Content-Type": type,
	"X-DCMA-Client": "web",
	"X-DCMA-Filename": encodeURIComponent(name),
});

test("local exports retain exact bytes at the chosen filename and replace a confirmed existing file", async (context) => {
	const f = await fixture(context, async (name, directory) => join(directory, `chosen-${name}`));
	const text = "# 完整报告\n\n温度 -2℃，含图表与证据。";
	const paths: string[] = [];
	for (let i = 0; i < 2; i++) {
		const contents = `${text}\n版本${i}`;
		const response = await fetch(f.url, { method: "POST", headers: headers("测试报告.md"), body: contents });
		assert.equal(response.status, 200);
		const result = (await response.json()) as { path: string; bytes: number };
		assert.equal(dirname(result.path), f.directory);
		assert.equal(result.bytes, Buffer.byteLength(contents));
		assert.equal(await readFile(result.path, "utf8"), contents);
		paths.push(result.path);
	}
	assert.equal(basename(paths[0]), "chosen-测试报告.md");
	assert.equal(paths[1], paths[0]);
	const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
	const image = await fetch(f.url, { method: "POST", headers: headers("chart.png", "image/png"), body: bytes });
	assert.equal(image.status, 200);
	assert.deepEqual(await readFile(((await image.json()) as { path: string }).path), bytes);
});

test("local exports reject methods, missing client marker, invalid filenames, types and empty files", async (context) => {
	const f = await fixture(context);
	assert.equal((await fetch(f.url)).status, 405);
	assert.equal((await fetch(f.url, { method: "POST", body: "x" })).status, 403);
	for (const name of ["../outside.md", "a/b.md", "C:\\outside.md", "CON.md", ".secret.md", "bad.exe", "trailing.md."])
		assert.equal((await fetch(f.url, { method: "POST", headers: headers(name), body: "x" })).status, 400);
	assert.equal((await fetch(f.url, { method: "POST", headers: headers("chart.png"), body: "x" })).status, 400);
	assert.equal((await fetch(f.url, { method: "POST", headers: headers("empty.md"), body: "" })).status, 400);
	assert.deepEqual(await readdir(f.directory), []);
});

test("streaming size limit removes the partial export and never alters existing files", async (context) => {
	const f = await fixture(context);
	const chunk = Buffer.alloc(1024 * 1024, "x");
	const request = Readable.from(
		(function* () {
			for (let i = 0; i < 33; i++) yield chunk;
		})(),
	) as unknown as IncomingMessage;
	request.method = "POST";
	request.headers = { "content-type": "text/plain", "x-dcma-client": "web", "x-dcma-filename": "too-large.txt" };
	let status = 0;
	const response = Object.assign(new EventEmitter(), {
		destroyed: false,
		writeHead(code: number) {
			status = code;
		},
		end() {},
	}) as unknown as ServerResponse;
	await handleExportHttp(request, response, async () => assert.fail("Oversized data must not open a dialog"));
	assert.equal(status, 413);
	assert.deepEqual(await readdir(f.directory), []);
});

test("cancelling writes nothing and a failed replacement preserves the previous file", async (context) => {
	const cancelled = await fixture(context, async () => null);
	const response = await fetch(cancelled.url, { method: "POST", headers: headers("report.md"), body: "report" });
	assert.deepEqual(await response.json(), { cancelled: true });
	assert.deepEqual(await readdir(cancelled.directory), []);
	const failed = await fixture(context, async (_, directory) => directory);
	const previous = join(failed.directory, "previous.md");
	await writeFile(previous, "keep this report");
	const failure = await fetch(failed.url, { method: "POST", headers: headers("report.md"), body: "new report" });
	assert.equal(failure.status, 500);
	assert.equal(await readFile(previous, "utf8"), "keep this report");
	assert.deepEqual(await readdir(failed.directory), ["previous.md"]);
});

test("browser export uses the local save endpoint, reports the actual path and never invokes a browser download", async (context) => {
	const f = await fixture(context);
	const original = Object.getOwnPropertyDescriptor(globalThis, "window");
	const target = new EventTarget();
	Object.defineProperty(globalThis, "window", { configurable: true, value: target });
	context.after(() => {
		if (original) Object.defineProperty(globalThis, "window", original);
		else Reflect.deleteProperty(globalThis, "window");
	});
	const messages: string[] = [];
	target.addEventListener(exportStatusEvent, (event) => messages.push((event as CustomEvent<string>).detail));
	const fetchToServer = globalThis.fetch;
	context.mock.method(globalThis, "fetch", (url: string | URL | Request, options?: RequestInit) => {
		assert.equal(url, "/api/exports");
		return fetchToServer(f.url, options);
	});
	context.mock.method(URL, "createObjectURL", () => {
		throw new Error("Browser downloads must not be used");
	});
	const path = await saveExportFile(
		"report.html",
		new Blob(["<!doctype html><h1>test</h1>"], { type: "text/html;charset=utf-8" }),
	);
	assert.ok(path);
	assert.equal(dirname(path), f.directory);
	assert.match(await readFile(path, "utf8"), /<h1>test/);
	assert.equal(messages.at(-1), `已保存：${path}`);
	await assert.rejects(saveExportFile("bad.exe", new Blob(["bad"], { type: "text/plain" })), /文件名或文件类型无效/);
	assert.match(messages.at(-1) ?? "", /文件名或文件类型无效/);
	context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ cancelled: true })));
	assert.equal(await saveExportFile("report.md", new Blob(["report"], { type: "text/markdown" })), "");
	assert.equal(messages.at(-1), "已取消保存。");
});
