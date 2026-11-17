import { getFaultKnowledgeHealth, searchFaultKnowledge } from "../knowledge-index.ts";
import { type KnowledgeEvaluationCase, knowledgeEvaluationCases } from "./evaluation-cases.ts";

const limit = 3;
const embeddingKey = "EMBEDDING_API_KEY";
const categories = ["exact", "symptom", "applicability"] as const;

type SearchResult = Awaited<ReturnType<typeof searchFaultKnowledge>>;

function reportCase(testCase: KnowledgeEvaluationCase, result: SearchResult) {
	const expectedRank = result.results.find((hit) =>
		testCase.expected.some((expected) =>
			hit.source_id === expected.source &&
			(!expected.locator || hit.locator === expected.locator) &&
			(!expected.code || hit.codes.includes(expected.code)) &&
			(testCase.kind !== "exact" || ("context_complete" in hit && hit.context_complete === true)),
		),
	)?.rank ?? null;
	const incompatibleRank = result.results.find((hit) => hit.source_id === testCase.incompatibleSource)?.rank ?? null;
	console.log(JSON.stringify({
		id: testCase.id,
		code: result.code,
		retrieval: result.retrieval,
		vectorQueryUsed: result.retrieval_log.vector_query_used,
		expectedRank,
		incompatibleRank,
		top: result.results.map((hit) => ({ source: hit.source_id, locator: hit.locator, title: hit.title })),
	}));
	return { testCase, expectedRank, incompatibleRank };
}

function reportSummary(mode: string, results: ReturnType<typeof reportCase>[]) {
	for (const category of categories) {
		const rows = results.filter(({ testCase }) => testCase.kind === category);
		if (!rows.length) continue;
		console.log(JSON.stringify({
			mode,
			category,
			scored: rows.length,
			withApplicableEvidence: rows.filter(({ testCase }) => testCase.expected.length > 0).length,
			top1: rows.filter(({ expectedRank }) => expectedRank === 1).length,
			top3: rows.filter(({ expectedRank }) => expectedRank !== null).length,
			incompatibleTop3: rows.filter(({ incompatibleRank }) => incompatibleRank !== null).length,
		}));
	}
}

function fallbackReason(notice: string | null): string {
	const httpStatus = notice?.match(/^嵌入服务请求失败（HTTP (\d{3}|未知)）$/u);
	if (httpStatus) return `嵌入服务 HTTP ${httpStatus[1]}`;
	switch (notice) {
		case "嵌入服务连接失败，已达到重试上限":
		case "查询向量维度与索引不一致；当前使用关键词检索":
		case "嵌入服务返回格式无效":
			return notice;
		default:
			return "未生成可用的查询向量";
	}
}

const args = process.argv.slice(2);
const compareHybrid = args.length === 1 && args[0] === "--hybrid";
if (args.length && !compareHybrid) throw new Error("用法：node packages/web/knowledge/evaluate.ts [--hybrid]");

const savedKey = process.env[embeddingKey];
const keywordResults: ReturnType<typeof reportCase>[] = [];
console.log("关键词基线");
try {
	delete process.env[embeddingKey];
	for (const testCase of knowledgeEvaluationCases) {
		keywordResults.push(reportCase(testCase, await searchFaultKnowledge({ q: testCase.query, limit })));
	}
} finally {
	if (savedKey !== undefined) process.env[embeddingKey] = savedKey;
}
reportSummary("keyword", keywordResults);
if (keywordResults.some(({ testCase, expectedRank }) => testCase.kind === "exact" && expectedRank !== 1)) {
	process.exitCode = 1;
}

if (compareHybrid) {
	const health = await getFaultKnowledgeHealth();
	const embedding = "embedding" in health ? health.embedding : undefined;
	const vectors = "vectors" in health ? health.vectors : undefined;
	let unavailable: string | undefined;
	if (!health.ok) unavailable = "知识库不可用";
	else if (!embedding?.configured) unavailable = "嵌入服务未配置";
	else if (!vectors?.ready) unavailable = "向量索引不可用或与配置、语料不匹配";

	const hybridResults: ReturnType<typeof reportCase>[] = [];
	console.log("启用嵌入后的检索");
	for (const { testCase } of keywordResults) {
		if (unavailable) {
			console.log(JSON.stringify({ id: testCase.id, skipped: unavailable }));
			continue;
		}
		const result = await searchFaultKnowledge({ q: testCase.query, limit });
		const row = reportCase(testCase, result);
		if (result.retrieval === "hybrid" && result.retrieval_log.vector_query_used) hybridResults.push(row);
		else if (!result.code) {
			unavailable = `后续查询跳过。首个降级案例 ${testCase.id}：${fallbackReason(result.retrieval_log.fallback)}`;
			console.log(JSON.stringify({ id: testCase.id, fallback: fallbackReason(result.retrieval_log.fallback) }));
		}
	}
	// Compare the same queries and exclude exact-code controls, which bypass embedding in both modes.
	const hybridIds = new Set(hybridResults.map(({ testCase }) => testCase.id));
	reportSummary("keyword-paired", keywordResults.filter(({ testCase }) => hybridIds.has(testCase.id)));
	reportSummary("hybrid", hybridResults);
	if (unavailable) process.exitCode = 1;
}
