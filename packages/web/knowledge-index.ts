import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { faultKnowledgeContext } from "./knowledge-context.ts";
import { ToolInputError } from "./tools/contracts.ts";
import {
	cosineSimilarity,
	getEmbeddingConfig,
	getFaultKnowledgeQueryVector,
	getStoredVectorIndex,
	getVectorIndexPath,
	vectorIndexMatches,
} from "./knowledge-vectors.ts";

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
	id?: string;
	source?: string;
	kind?: string;
	limit?: number;
}

export interface FaultKnowledgeRetrievalLog {
	query: string;
	retrieval: "hybrid" | "keyword";
	embedding_configured: boolean;
	embedding_model: string | null;
	vector_index_ready: boolean;
	vector_query_used: boolean;
	candidate_count: number;
	returned_count: number;
	semantic_threshold: number;
	fallback: string | null;
}

const knowledgePath = resolve(fileURLToPath(new URL("./knowledge/data/knowledge.jsonl", import.meta.url)));
export const maxLimit = 20;
const minimumSemanticScore = 0.15;
const faultCodeInQuery = /(?:^|[^A-Za-z0-9])([FANW]\d{4,6})(?!\d)/i;
let indexPromise: Promise<FaultKnowledgeRecord[]> | undefined;

function normalize(value: string): string {
	return value.toLocaleLowerCase().replace(/[\u0000-\u001f]/g, " ").trim();
}

function tokens(value: string): string[] {
	return normalize(value).split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 2);
}

function inferFaultCode(query: string): string {
	return query.match(faultCodeInQuery)?.[1]?.trim() ?? "";
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
	const requestedCode = options.code?.trim() || inferFaultCode(query);
	const requestedId = options.id?.trim() ?? "";
	const source = options.source?.trim() ?? "";
	const kind = options.kind?.trim() ?? "";
	const requestedLimit = options.limit ?? 8;
	const limit = Number.isFinite(requestedLimit) ? Math.min(maxLimit, Math.max(1, Math.floor(requestedLimit))) : 8;
	const queryTokens = tokens(query);
	const records = await getFaultKnowledgeIndex();
	const kinds = [...new Set(records.map((item) => item.kind))];
	const sources = [...new Set(records.map((item) => item.source_id))];
	if (kind && !kinds.includes(kind))
		throw new ToolInputError(`kind是资料类型，不是故障或报警类型；允许值：${kinds.join("、")}。请纠正参数后重试，本次未执行检索。`);
	if (source && !sources.includes(source))
		throw new ToolInputError(`source须填写来源编号sourceId，不是文件名；允许值：${sources.join("、")}。请纠正参数后重试，本次未执行检索。`);
	const config = getEmbeddingConfig();
	let vectorIndex = null;
	let retrievalNotice: string | undefined;
	if (config) {
		try {
			vectorIndex = await getStoredVectorIndex();
		} catch (error) {
			retrievalNotice = error instanceof Error ? `向量索引无法读取：${error.message}` : "向量索引无法读取";
		}
	}
	const vectorIndexReady = vectorIndexMatches(vectorIndex, records, config);
	if (!vectorIndexReady) vectorIndex = null;
	let queryVector: number[] | null = null;
	let retrieval: "hybrid" | "keyword" = "keyword";
	if (query && !requestedCode && config && vectorIndex) {
		try {
			queryVector = await getFaultKnowledgeQueryVector(query);
			if (queryVector && vectorIndex && queryVector.length !== vectorIndex.dimensions) {
				queryVector = null;
				retrievalNotice = "查询向量维度与索引不一致；当前使用关键词检索";
			}
			retrieval = queryVector ? "hybrid" : "keyword";
		} catch (error) {
			retrievalNotice = error instanceof Error ? error.message : "云端语义检索暂不可用";
		}
	} else if (query && !requestedCode && config && !vectorIndex && !retrievalNotice) {
		retrievalNotice = "向量索引未构建或与当前知识资料、嵌入服务、模型不匹配；当前使用关键词检索";
	} else if (query && !requestedCode && !config) {
		retrievalNotice = "嵌入服务未配置；当前使用关键词检索";
	} else if (requestedCode) {
		retrievalNotice = "故障码精确查询按设计跳过向量查询";
	}
	const vectorById = new Map(vectorIndex?.items.map((item) => [item.id, item.vector]) ?? []);
	const candidates = records.filter(
		(item) =>
			(!requestedId || item.id === requestedId) &&
			(!source || item.source_id === source) &&
			(!kind || item.kind === kind) &&
			(!requestedCode || item.codes.some((code) => normalize(code) === normalize(requestedCode))),
	).flatMap((item) => {
		const context = faultKnowledgeContext(records, item, requestedCode);
		return context ? [{ item, context }] : [];
	});
	const ranked = candidates
		.map(({ item, context }) => {
			const lexicalScore = score(item, query, requestedCode);
			const vector = queryVector ? vectorById.get(item.id) : undefined;
			const semanticScore = vector && queryVector ? Math.max(0, cosineSimilarity(vector, queryVector)) : 0;
			const acceptedSemanticScore = semanticScore >= minimumSemanticScore ? semanticScore : 0;
			const combinedScore = lexicalScore + acceptedSemanticScore * 30;
			return { item, context, lexicalScore, semanticScore: acceptedSemanticScore, combinedScore };
		})
		.filter((row) => !queryTokens.length || row.combinedScore > 0)
		.sort((a, b) => b.combinedScore - a.combinedScore || (a.item.page ?? 0) - (b.item.page ?? 0))
		.slice(0, limit);
	const retrievalLog: FaultKnowledgeRetrievalLog = {
		query,
		retrieval,
		embedding_configured: Boolean(config),
		embedding_model: config?.model ?? null,
		vector_index_ready: vectorIndexReady,
		vector_query_used: Boolean(queryVector),
		candidate_count: candidates.length,
		returned_count: ranked.length,
		semantic_threshold: minimumSemanticScore,
		fallback: retrievalNotice ?? null,
	};
	const response = {
		query,
		code: requestedCode || null,
		id: requestedId || null,
		source: source || null,
		kind: kind || null,
		retrieval,
		...(retrievalNotice ? { retrieval_notice: retrievalNotice } : {}),
		count: ranked.length,
		truncated: false,
		result_notice: null as string | null,
		retrieval_log: retrievalLog,
		results: ranked.map(({ item, context, lexicalScore, semanticScore, combinedScore }, index) => {
			const citationId = `KB-${String(index + 1).padStart(3, "0")}`;
			const sourceUrl = `/api/knowledge/context?id=${encodeURIComponent(item.id)}${requestedCode ? `&code=${encodeURIComponent(requestedCode)}` : ""}`;
			return {
				...context,
				citation_id: citationId,
				rank: index + 1,
				source_url: sourceUrl,
				citation: `[${citationId}] ${context.source_file}，定位：${context.locator || "未提供"}，页码：${context.page ?? "未提供"}，来源URL：${sourceUrl}`,
				score: combinedScore,
				combined_score: combinedScore,
				lexical_score: lexicalScore,
				semantic_score: semanticScore,
			};
		}),
	};
	// Keep complete, higher-ranked contexts within the tool's 62KB result limit.
	while (response.results.length && Buffer.byteLength(JSON.stringify(response)) > 60000) {
		response.results.pop();
		response.truncated = true;
		response.result_notice = "跨页资料较长，已按排名减少返回条数；本次不是全部命中结果，可按故障码或来源进一步查询。";
		response.count = response.results.length;
		retrievalLog.returned_count = response.count;
	}
	return response;
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
		const embedding = getEmbeddingConfig();
		let vectors = null;
		let vectorError: string | undefined;
		try {
			vectors = await getStoredVectorIndex();
		} catch (error) {
			vectorError = error instanceof Error ? error.message : "向量索引无法读取";
		}
		const currentRecords = await getFaultKnowledgeIndex();
		const vectorReady = vectorIndexMatches(vectors, currentRecords, embedding);
		return {
			ok: true,
			records,
			index: knowledgePath,
			retrieval: vectorReady ? "hybrid" : "keyword",
			embedding: { configured: Boolean(embedding), model: embedding?.model ?? null },
			vectors: {
				ready: vectorReady,
				records: vectorReady && vectors ? vectors.items.length : 0,
				index: getVectorIndexPath(),
				...(vectorError ? { error: vectorError } : {}),
			},
		};
	} catch (error) {
		return { ok: false, records: 0, index: knowledgePath, error: error instanceof Error ? error.message : "知识库不可用" };
	}
}
