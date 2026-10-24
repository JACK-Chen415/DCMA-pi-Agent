import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { chartIdPattern } from "../chart-contracts.ts";
import { type EvidenceBundle, type EvidenceRecord, validateEvidenceBundle } from "../interaction-contracts.ts";
import { preparePrivateDirectory } from "./runtime-files.ts";

const maximumBytes = 2 * 1024 * 1024;
const writes = new Map<string, Promise<unknown>>();

/** Persist successful tool results separately from the model's claims. */
export function createEvidenceArchive(directory: string, requestId: string) {
	if (!chartIdPattern.test(requestId)) throw new Error("查询证据编号无效。");
	const bundle: EvidenceBundle = { version: 1, requestId, records: [] };
	return async (record: EvidenceRecord) => {
		const pending = (writes.get(directory) ?? Promise.resolve())
			.catch(() => {})
			.then(async () => {
				const next = { ...bundle, records: [...bundle.records, record] };
				validateEvidenceBundle(next, requestId);
				const content = JSON.stringify(next);
				if (Buffer.byteLength(content) > maximumBytes) throw new Error("查询证据超过2MiB。");
				await preparePrivateDirectory(directory);
				const folder = join(directory, "evidence");
				await preparePrivateDirectory(folder);
				const names = (await readdir(folder)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
				if (!names.includes(`${requestId}.json`) && names.length >= 100)
					throw new Error("本机已保存100轮查询证据，请先人工归档。");
				const temporary = join(folder, `.${randomUUID()}.tmp`);
				const file = await open(
					temporary,
					constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
					0o600,
				);
				try {
					await file.writeFile(content, "utf8");
					await file.sync();
					await file.close();
					await rename(temporary, join(folder, `${requestId}.json`));
					bundle.records = next.records;
				} finally {
					await file.close().catch(() => {});
					await unlink(temporary).catch(() => {});
				}
			});
		writes.set(directory, pending);
		try {
			await pending;
		} finally {
			if (writes.get(directory) === pending) writes.delete(directory);
		}
	};
}

export async function readEvidence(directory: string, requestId: string): Promise<EvidenceBundle> {
	if (!chartIdPattern.test(requestId)) throw new Error("查询证据编号无效。");
	await preparePrivateDirectory(directory);
	const folder = join(directory, "evidence");
	await preparePrivateDirectory(folder);
	const file = await open(
		join(folder, `${requestId}.json`),
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size > maximumBytes) throw new Error("查询证据文件无效或过大。");
		const buffer = Buffer.alloc(maximumBytes + 1);
		let size = 0;
		while (size < buffer.length) {
			const read = await file.read(buffer, size, buffer.length - size, size);
			if (!read.bytesRead) break;
			size += read.bytesRead;
		}
		if (size > maximumBytes) throw new Error("查询证据文件过大。");
		return validateEvidenceBundle(
			JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))),
			requestId,
		);
	} finally {
		await file.close();
	}
}
