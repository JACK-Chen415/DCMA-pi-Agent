import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface FaultKnowledgeRecord {
	id: string;
	source_id: string;
	source_file: string;
	locator: string;
	page: number | null;
	title: string;
	kind: string;
	trust: string;
	codes: string[];
	text: string;
	agent_use: string;
}

export interface FaultKnowledgeSource {
	sourceId: string;
	title: string;
	kind: string;
	file: string;
	trust: string;
	records: number;
}

interface SearchOptions {
	q?: string;
	code?: string;
	source?: string;
	kind?: string;
	limit?: number;
}

const knowledgePath = resolve(fileURLToPath(new URL("./knowledge/data/knowledge.jsonl", import.meta.url)));
export const maxLimit = 20;
let indexPromise: Promise<FaultKnowledgeRecord[]> | undefined;

function normalize(value: string): string {
	return value.toLocaleLowerCase().replace(/[\u0000-\u001f]/g, " ").trim();
}

function tokens(value: string): string[] {
	return normalize(value).split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 2);
}

function isRecord(value: unknown): value is FaultKnowledgeRecord {
	if (!value || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.id === "string" &&
		typeof item.source_id === "string" &&
		typeof item.source_file === "string" &&
		typeof item.locator === "string" &&
		(item.page === null || typeof item.page === "number") &&
		typeof item.title === "string" &&
		typeof item.kind === "string" &&
		typeof item.trust === "string" &&
		Array.isArray(item.codes) &&
		item.codes.every((code) => typeof code === "string") &&
		typeof item.text === "string" &&
		typeof item.agent_use === "string"
	);
}

async function loadIndex(): Promise<FaultKnowledgeRecord[]> {
	const contents = await readFile(knowledgePath, "utf8");
	const records: FaultKnowledgeRecord[] = [];
	for (const [lineNumber, line] of contents.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line) as unknown;
		} catch {
			throw new Error(`知识库索引第 ${lineNumber + 1} 行不是有效 JSON`);
		}
		if (!isRecord(value)) throw new Error(`知识库索引第 ${lineNumber + 1} 行字段无效`);
		records.push(value);
	}
	if (!records.length) throw new Error("知识库索引为空");
	return records;
}

export async function getFaultKnowledgeIndex(): Promise<FaultKnowledgeRecord[]> {
	indexPromise ??= loadIndex().catch((error: unknown) => {
		indexPromise = undefined;
		throw error;
	});
	return indexPromise;
}

function score(item: FaultKnowledgeRecord, query: string, requestedCode: string): number {
	const queryTokens = tokens(query);
	const haystack = normalize(`${item.title} ${item.text} ${item.codes.join(" ")}`);
	const exactCode = Boolean(requestedCode) && item.codes.some((code) => normalize(code) === normalize(requestedCode));
	const tokenHits = queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
	const titleHits = queryTokens.reduce((sum, token) => sum + (normalize(item.title).includes(token) ? 1 : 0), 0);
	return (exactCode ? 100 : 0) + tokenHits * 4 + titleHits * 3;
}

export async function searchFaultKnowledge(options: SearchOptions = {}) {
	const query = options.q?.trim() ?? "";
	const requestedCode = options.code?.trim() ?? "";
	const source = options.source?.trim() ?? "";
	const kind = options.kind?.trim() ?? "";
	const requestedLimit = options.limit ?? 8;
	const limit = Number.isFinite(requestedLimit) ? Math.min(maxLimit, Math.max(1, Math.floor(requestedLimit))) : 8;
	const queryTokens = tokens(query);
	const records = await getFaultKnowledgeIndex();
	const ranked = records
		.filter(
			(item) =>
				(!source || item.source_id === source) &&
				(!kind || item.kind === kind) &&
				(!requestedCode || item.codes.some((code) => normalize(code) === normalize(requestedCode))),
		)
		.map((item) => ({ item, score: score(item, query, requestedCode) }))
		.filter((row) => !queryTokens.length || row.score > 0)
		.sort((a, b) => b.score - a.score || (a.item.page ?? 0) - (b.item.page ?? 0))
		.slice(0, limit);
	return {
		query,
		code: requestedCode || null,
		source: source || null,
		kind: kind || null,
		count: ranked.length,
		results: ranked.map(({ item, score: itemScore }) => ({ ...item, score: itemScore })),
	};
}

export async function listFaultKnowledgeSources(): Promise<{ sources: FaultKnowledgeSource[]; records: number }> {
	const records = await getFaultKnowledgeIndex();
	const sourceMap = new Map<string, FaultKnowledgeSource>();
	for (const item of records) {
		const existing = sourceMap.get(item.source_id);
		if (existing) {
			existing.records++;
			continue;
		}
		sourceMap.set(item.source_id, {
			sourceId: item.source_id,
			title: item.title,
			kind: item.kind,
			file: item.source_file,
			trust: item.trust,
			records: 1,
		});
	}
	return { sources: [...sourceMap.values()], records: records.length };
}

export async function getFaultKnowledgeHealth() {
	try {
		const { records } = await listFaultKnowledgeSources();
		return { ok: true, records, index: knowledgePath };
	} catch (error) {
		return { ok: false, records: 0, index: knowledgePath, error: error instanceof Error ? error.message : "知识库不可用" };
	}
}


