import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open, rename, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { maximumConversationBytes, type SavedConversations, validateConversations } from "../src/conversation-state.ts";
import { preparePrivateDirectory } from "./runtime-files.ts";

export function createConversationStore(runtimeDirectory: string) {
	const directory = join(runtimeDirectory, "conversations");
	const file = join(directory, "state.json");
	let queue: Promise<unknown> = Promise.resolve();
	async function read(): Promise<SavedConversations | null> {
		await preparePrivateDirectory(directory);
		let handle: FileHandle;
		try {
			handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
			throw error;
		}
		try {
			const info = await handle.stat();
			if (!info.isFile() || info.size > maximumConversationBytes) throw new Error("聊天记录文件过大或无效。");
			const buffer = Buffer.alloc(info.size + 1);
			let length = 0;
			while (length < buffer.length) {
				const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
				if (!bytesRead) break;
				length += bytesRead;
			}
			if (length > info.size) throw new Error("聊天记录文件在读取时发生变化。");
			return validateConversations(JSON.parse(buffer.subarray(0, length).toString("utf8")));
		} finally {
			await handle.close();
		}
	}
	return {
		read,
		save(value: unknown): Promise<SavedConversations | null> {
			const pending = queue.then(async () => {
				const next = validateConversations(value);
				const current = await read();
				if (next.revision !== (current?.revision ?? 0)) return null;
				const saved = { ...next, revision: next.revision + 1 };
				const content = JSON.stringify(saved);
				if (Buffer.byteLength(content) > maximumConversationBytes)
					throw new Error("聊天记录超过32MiB，请先导出并归档。");
				const temporary = join(directory, `.${randomUUID()}.tmp`);
				try {
					const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
					try {
						await handle.writeFile(content, "utf8");
						await handle.sync();
					} finally {
						await handle.close();
					}
					await rename(temporary, file);
				} finally {
					await unlink(temporary).catch(() => {});
				}
				return saved;
			});
			queue = pending.catch(() => {});
			return pending;
		},
	};
}

export async function handleConversationHttp(
	request: IncomingMessage,
	response: ServerResponse,
	store: ReturnType<typeof createConversationStore>,
): Promise<void> {
	const json = (status: number, value: unknown) => {
		response.writeHead(status, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		response.end(JSON.stringify(value));
	};
	if (request.method !== "GET" && request.method !== "PUT") {
		json(405, { error: "仅支持 GET 或 PUT" });
		return;
	}
	if (request.method === "GET") {
		try {
			json(200, await store.read());
		} catch {
			json(500, { error: "本机聊天记录读取失败，原文件已保留。请检查文件后重试。" });
		}
		return;
	}
	if (request.headers["x-dcma-client"] !== "web" || !request.headers["content-type"]?.startsWith("application/json")) {
		json(403, { error: "请求来源或内容类型无效" });
		return;
	}
	let value: SavedConversations;
	try {
		const chunks: Buffer[] = [];
		let bytes = 0;
		for await (const chunk of request) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			bytes += buffer.length;
			if (bytes > maximumConversationBytes) {
				json(413, { error: "聊天记录超过32MiB，请先导出并归档。" });
				return;
			}
			chunks.push(buffer);
		}
		value = validateConversations(JSON.parse(Buffer.concat(chunks).toString("utf8")));
	} catch {
		json(400, { error: "聊天记录格式无效，未覆盖本机记录。" });
		return;
	}
	try {
		const saved = await store.save(value);
		if (!saved) json(409, { error: "聊天记录已被其他页面更新，请先导出当前记录，再刷新页面。" });
		else json(200, { revision: saved.revision });
	} catch {
		json(500, { error: "本机聊天记录保存失败，请导出当前记录并重试。" });
	}
}
