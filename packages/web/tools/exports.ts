import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open, rename, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { chooseExportPath } from "./save-dialog.ts";

const maximumBytes = 32 * 1024 * 1024;
const formats: Record<string, string> = {
	".html": "text/html",
	".md": "text/markdown",
	".txt": "text/plain",
	".json": "application/json",
	".csv": "text/csv",
	".png": "image/png",
	".svg": "image/svg+xml",
};

/** The browser supplies contents and a suggested name; the user chooses the destination locally. */
export async function handleExportHttp(
	request: IncomingMessage,
	response: ServerResponse,
	choosePath = chooseExportPath,
): Promise<void> {
	const json = (status: number, body: unknown) => {
		if (response.destroyed) return;
		response.writeHead(status, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		response.end(JSON.stringify(body));
	};
	if (request.method !== "POST") {
		json(405, { error: "仅支持保存导出文件。" });
		return;
	}
	if (request.headers["x-dcma-client"] !== "web") {
		json(403, { error: "请从本机工作台导出。" });
		return;
	}
	let name: string;
	try {
		name = decodeURIComponent(String(request.headers["x-dcma-filename"] ?? ""));
	} catch {
		json(400, { error: "导出文件名无效。" });
		return;
	}
	const extension = extname(name).toLowerCase();
	if (
		!name ||
		name.length > 200 ||
		/[\\/:*?"<>|\u0000-\u001f]/.test(name) ||
		/[. ]$/.test(name) ||
		name.startsWith(".") ||
		/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
		!Object.hasOwn(formats, extension) ||
		request.headers["content-type"]?.split(";")[0].trim() !== formats[extension]
	) {
		json(400, { error: "文件名或文件类型无效，仅支持报告、数据和图片。" });
		return;
	}
	const length = Number(request.headers["content-length"]);
	if (Number.isFinite(length) && length > maximumBytes) {
		json(413, { error: "导出文件超过32MiB。" });
		return;
	}
	let file: FileHandle | undefined;
	let temporary = "";
	let tooLarge = false;
	const controller = new AbortController();
	const cancel = () => controller.abort();
	response.once("close", cancel);
	const discard = async () => {
		await file?.close().catch(() => {});
		file = undefined;
		if (temporary) await unlink(temporary).catch(() => {});
	};
	try {
		const chunks: Buffer[] = [];
		let bytes = 0;
		// Drain an oversized request without retaining more data, so the browser receives the error response.
		for await (const chunk of request) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			bytes += buffer.length;
			if (bytes > maximumBytes) {
				tooLarge = true;
				continue;
			}
			chunks.push(buffer);
		}
		if (tooLarge) {
			await discard();
			json(413, { error: "导出文件超过32MiB。" });
			return;
		}
		if (!bytes) {
			await discard();
			json(400, { error: "导出文件为空。" });
			return;
		}
		const path = await choosePath(name, controller.signal);
		if (controller.signal.aborted) return;
		if (path === null) {
			json(200, { cancelled: true });
			return;
		}
		if (typeof path !== "string") {
			json(200, path);
			return;
		}
		// Write beside the selected file, then replace atomically so failures preserve any existing report.
		temporary = join(dirname(path), `.dcma-export-${randomUUID()}.tmp`);
		file = await open(
			temporary,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		await file.writeFile(Buffer.concat(chunks, bytes));
		await file.sync();
		await file.close();
		file = undefined;
		if (controller.signal.aborted) return;
		await rename(temporary, path);
		temporary = "";
		json(200, { path, bytes });
	} catch (error) {
		await discard();
		json(500, {
			error:
				error instanceof Error ? `文件保存失败：${error.message}` : "文件保存失败，请检查所选位置的权限和空间。",
		});
	} finally {
		response.removeListener("close", cancel);
		await discard();
	}
}
