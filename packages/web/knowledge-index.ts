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
	/** 查询点名的设备系列与来源归属冲突、被排除或降权的来源；无冲突时缺省。 */
	family_conflict?: string[];
	fallback: string | null;
}

const knowledgePath = resolve(fileURLToPath(new URL("./knowledge/data/knowledge.jsonl", import.meta.url)));
export const maxLimit = 20;
const minimumSemanticScore = 0.15;
const faultCodeInQuery = /(?:^|[^A-Za-z0-9])([FANW]\d{4,6})(?!\d)/i;
// 型号形如 G120、CU250、YFB801-2、90L-4：字母数字混合、含连字符或以字母开头、长度 ≥3。
const equipmentModelInQuery = /(?:^|[^\p{L}\p{N}])([\p{L}\d][\p{L}\p{N}-]{1,10})(?=[^\p{L}\p{N}]|$)/gu;
// 查询点名某驱动系列（如 G120）时，语料中归属其它系列（S120/S150）的来源被排除，避免冒充适用手册。
const incompatibleFamilies: Record<string, readonly string[]> = { g120: ["s120-fault-manual"] };
const sourceFamilyDesignators: Record<string, readonly string[]> = { "s120-fault-manual": ["s120", "s150"] };
// 口语说法 → 手册/章节标题用语。检索时把扩展出的词以较低权重并入查询词组。
const symptomExpansionRules: readonly (readonly [RegExp, readonly string[]])[] = [
	[/嗡嗡/, ["嗡嗡异响"]],
	[/送电|上电/, ["通电"]],
	[/(?:不|没|无法|不能)(?:转|启动|转动)/, ["不启动"]],
	[/转得[^，。；]*慢|转速不够|转速上不去|速度上不来/, ["转速不足"]],
	[/没劲|无力|出力不够|带不动|转矩不够/, ["出力不足"]],
	[/烫|发热|温度高|超温|越来越热/, ["过热"]],
	[/时有时无|断断续续|卡顿|刷新中断|断连|丢包/, ["通讯", "数据丢包"]],
	[/下不去|下发不了|修改不了|写不进去/, ["下发"]],
	[/缺相|断相/, ["缺相"]],
];
const expandedTokenWeight = 0.5;
// 每份 docx 的首段是标题/元数据概览（无章节标题），词法上吸引所有该文档的查询，按导航内容降权。
const overviewLocatorPattern = /^段落 1-\d/;
const overviewScoreFactor = 0.35;
const recordModelAffinityScore = 8;
const sourceModelAffinityScore = 6;
let indexPromise: Promise<FaultKnowledgeRecord[]> | undefined;

function normalize(value: string): string {
	return value.toLocaleLowerCase().replace(/[\u0000-\u001f]/g, " ").trim();
}

function tokens(value: string): string[] {
	const parts = normalize(value).split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
	const result: string[] = [];
	for (const part of parts) {
		// 拉丁/数字片段（含型号）保留整段；CJK 片段切 2-gram，让口语短语能与手册用语部分重叠。
		if (!/\p{Script=Han}/u.test(part)) {
			if (part.length >= 2) result.push(part);
			continue;
		}
		if (part.length === 1) continue;
		for (let index = 0; index < part.length - 1; index++) result.push(part.slice(index, index + 2));
	}
	return result;
}

interface QueryTerms {
	direct: string[];
	expanded: string[];
	models: string[];
	conflicts: string[];
}

function inferFaultCode(query: string): string {
	return query.match(faultCodeInQuery)?.[1]?.trim() ?? "";
}

function inferEquipmentModels(query: string): string[] {
	return [...normalize(query).matchAll(equipmentModelInQuery)]
		.map((match) => match[1]!.toLowerCase())
		.filter(
			(model) =>
				model.length >= 3 &&
				/\p{L}/u.test(model) &&
				/\d/.test(model) &&
				// 故障码（F30004 等）不是设备型号。
				! /^[fancw]\d{4,6}$/i.test(model),
		);
}

/** 查询点名某驱动系列且未同时点名冲突来源自身的系列时，返回应排除的来源。 */
function inferFamilyConflicts(models: string[]): string[] {
	const named = new Set(models.map((model) => model.replace(/-/g, "")));
	const conflicts = new Set<string>();
	for (const model of models) {
		for (const source of incompatibleFamilies[model.replace(/-/g, "")] ?? []) {
			if (!(sourceFamilyDesignators[source] ?? []).some((designator) => named.has(designator))) conflicts.add(source);
		}
	}
	return [...conflicts];
}

function queryTerms(query: string): QueryTerms {
	const normalized = normalize(query);
	const seen = new Set<string>();
	const direct = tokens(query).filter((token) => (seen.has(token) ? false : (seen.add(token), true)));
	const expanded: string[] = [];
	const expandedSeen = new Set<string>();
	for (const [pattern, phrases] of symptomExpansionRules) {
		if (!pattern.test(normalized)) continue;
		for (const phrase of phrases) {
			for (const token of tokens(phrase)) {
				if (!seen.has(token) && !expandedSeen.has(token)) {
					expandedSeen.add(token);
					expanded.push(token);
				}
			}
		}
	}
	const models = inferEquipmentModels(query);
	return { direct, expanded, models, conflicts: inferFamilyConflicts(models) };
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

interface LexicalContext {
	terms: QueryTerms;
	requestedCode: string;
	/** token → 出现该 token 的记录数；IDF 加权用，随索引缓存。 */
	documentFrequency: Map<string, number>;
	totalRecords: number;
}

const lexicalStats = new WeakMap<FaultKnowledgeRecord[], Map<string, number>>();

/** 一次性统计每个 token 出现在多少条记录里；常见字组（“电机”“手册”）IDF 低，现象词 IDF 高。 */
function getLexicalContext(records: FaultKnowledgeRecord[], terms: QueryTerms, requestedCode: string): LexicalContext {
	let stats = lexicalStats.get(records);
	if (!stats) {
		stats = new Map();
		const seen = new Set<string>();
		for (const item of records) {
			seen.clear();
			for (const token of tokens(`${item.title} ${item.text} ${item.codes.join(" ")}`)) {
				if (seen.has(token)) continue;
				seen.add(token);
				stats.set(token, (stats.get(token) ?? 0) + 1);
			}
		}
		lexicalStats.set(records, stats);
	}
	return { terms, requestedCode, documentFrequency: stats, totalRecords: records.length };
}

/** 查询里的型号在该记录自身文本中出现的次数：≥1 说明这条记录讲的就是这台设备。 */
function recordModelAffinity(item: FaultKnowledgeRecord, models: string[]): number {
	if (!models.length) return 0;
	const haystack = normalize(item.text);
	return models.reduce((sum, model) => sum + (haystack.includes(model) ? 1 : 0), 0);
}

/** 查询里的型号在记录所属来源（含标题）中出现的次数：来源级归属信号。 */
function sourceModelAffinity(item: FaultKnowledgeRecord, models: string[]): number {
	if (!models.length) return 0;
	const haystack = normalize(`${item.title} ${item.text}`);
	return models.reduce((sum, model) => sum + (haystack.includes(model) ? 1 : 0), 0);
}

function score(item: FaultKnowledgeRecord, query: string, lexical: LexicalContext): number {
	const { terms, requestedCode, documentFrequency, totalRecords } = lexical;
	const exactCode = Boolean(requestedCode) && item.codes.some((code) => normalize(code) === normalize(requestedCode));
	const haystack = normalize(`${item.title} ${item.text} ${item.codes.join(" ")}`);
	const title = normalize(item.title);
	const weighted = (tokenList: string[], weight: number) =>
		tokenList.reduce((sum, token) => {
			if (!haystack.includes(token)) return sum;
			const idf = Math.log(1 + totalRecords / (documentFrequency.get(token) ?? 1));
			return sum + idf * weight;
		}, 0);
	const tokenScore = weighted(terms.direct, 1) + weighted(terms.expanded, expandedTokenWeight);
	const titleScore = [...terms.direct, ...terms.expanded].reduce(
		(sum, token) => sum + (title.includes(token) ? 3 : 0),
		0,
	);
	return (
		(exactCode ? 100 : 0) +
		tokenScore * 2 +
		titleScore +
		recordModelAffinity(item, terms.models) * recordModelAffinityScore +
		sourceModelAffinity(item, terms.models) * sourceModelAffinityScore
	);
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
	const terms = queryTerms(query);
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
	const lexical = getLexicalContext(records, terms, requestedCode);
	// 查询点名某驱动系列（如 G120）且未同时点名 S120 时，冲突来源整体不进入候选。
	const candidates = records.filter(
		(item) =>
			(!terms.conflicts.length || !terms.conflicts.includes(item.source_id)) &&
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
			const lexicalScore = score(item, query, lexical);
			const vector = queryVector ? vectorById.get(item.id) : undefined;
			const semanticScore = vector && queryVector ? Math.max(0, cosineSimilarity(vector, queryVector)) : 0;
			const acceptedSemanticScore = semanticScore >= minimumSemanticScore ? semanticScore : 0;
			const overviewFactor = overviewLocatorPattern.test(item.locator) ? overviewScoreFactor : 1;
			const combinedScore = Math.max(0, (lexicalScore + acceptedSemanticScore * 30) * overviewFactor);
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
		...(terms.conflicts.length ? { family_conflict: terms.conflicts } : {}),
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
