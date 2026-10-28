import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import type { EvidenceBundle } from "../interaction-contracts.ts";
import { evidenceSections, evidenceSummary } from "../src/evidence.ts";
import { remarkLimitations } from "../src/remark-limitations.ts";
import { analysisReportHtml, completeMessageReport } from "../src/report.ts";
import { remarkSecondPrecision, timeToSeconds } from "../src/time-display.ts";
import type { ChatMessage } from "../src/types.ts";
import { buildChart } from "../tools/charts.ts";
import { chartFixture } from "./chart-fixture.ts";

const id = "11111111-1111-4111-8111-111111111111";
const chart = buildChart(
	{ evidenceId: id, kind: "line", metrics: ["motor_temp"] },
	chartFixture([0, null, -2, 4, 5]),
	"summarize_metrics",
);
const message: ChatMessage = {
	id,
	role: "assistant",
	timestamp: "2026-10-22T00:00:00.000Z",
	status: "done",
	engine: "test",
	content: "## 结论\n\n温度变化。\n\n| 指标 | 结果 |\n|---|---|\n|最低温度| -2 |\n\n<script>alert(1)</script>",
	charts: [{ version: 1, id: chart.id }],
	steps: [{ tool: "summarize_metrics", callId: "c", status: "done", evidenceId: id }],
};
const bundle: EvidenceBundle = {
	version: 1,
	requestId: id,
	records: [
		{
			id,
			tool: "summarize_metrics",
			createdAt: message.timestamp,
			input: { from: chart.sources[0].from },
			result: { ...chart.sources[0], records: 5, metrics: [{ min: -2, max: 5, missing: 1 }] },
		},
	],
};

test("standalone report contains formatted answer, inline SVG and readable evidence without technical data dumps", () => {
	const html = analysisReportHtml(message, [chart], bundle, "<img src=x onerror=alert(1)>");
	assert.ok(html.startsWith("<!doctype html>"));
	assert.match(html, /<svg/);
	assert.match(html, /<table>/);
	assert.match(html, /查询与资料证据/);
	assert.match(html, /覆盖采样：5 条/);
	assert.doesNotMatch(html, /高级信息|&quot;rows&quot;|&quot;parameters&quot;|&quot;missing&quot;/);
	assert.match(html, /&lt;img/);
	assert.ok(!html.includes("<script>"));
	assert.ok(!html.includes("<img src=x"));
	assert.match(html, /Content-Security-Policy/);
	assert.match(html, /2026\/10\/22 08:00:00/);
});

test("complete report fetches saved artifacts only and rejects missing or mismatched evidence", async (context) => {
	const paths: string[] = [];
	context.mock.method(globalThis, "fetch", async (path: string) => {
		paths.push(path);
		return new Response(JSON.stringify(path.includes("/charts/") ? chart : bundle));
	});
	assert.match(await completeMessageReport(message), /<svg/);
	assert.equal(paths.length, 2);
	assert.ok(paths.every((path) => path.startsWith("/api/tools/")));
	context.mock.method(
		globalThis,
		"fetch",
		async (path: string) =>
			new Response(JSON.stringify(path.includes("/charts/") ? chart : { ...bundle, records: [] })),
	);
	await assert.rejects(completeMessageReport(message), /不完整/);
	context.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 404 }));
	await assert.rejects(completeMessageReport(message), /快照不可读取/);
	assert.match(analysisReportHtml({ ...message, charts: [], steps: [] }, [], null), /没有已保存的查询证据/);
});

test("evidence summary retains manual identity, original excerpts, scope and truncation", () => {
	const summary = evidenceSummary({
		...bundle.records[0],
		result: {
			...(bundle.records[0].result as object),
			truncated: true,
			matches: [{ text: "跨页原文\n适用条件", source: { title: "测试手册", locator: "第3—4页", revision: "v1" } }],
		},
	}).join("\n");
	assert.match(summary, /模拟数据/);
	assert.match(summary, /北京时间/);
	assert.match(summary, /第3—4页/);
	assert.match(summary, /跨页原文/);
	assert.match(summary, /截断/);
});

test("report evidence provides a readable title and included-result count while preserving raw data", () => {
	const record = {
		...bundle.records[0],
		tool: "export_analysis_report",
		input: { title: "近一周设备状况报告", evidenceIds: [id] },
		result: {
			reportId: id,
			markdownUrl: `/api/tools/reports/${id}.md`,
			jsonUrl: `/api/tools/reports/${id}.json`,
			evidenceIds: [id],
		},
	};
	const before = JSON.stringify(record);
	assert.deepEqual(evidenceSections(record)[0].facts, [
		{ label: "报告名称", value: "近一周设备状况报告" },
		{ label: "包含内容", value: "1 项查询结果与参考资料" },
	]);
	assert.ok(!evidenceSummary(record).join("").includes(id));
	assert.equal(JSON.stringify(record), before);
});

test("evidence sections separate comparison windows, retain warnings and format metrics without changing snapshots", () => {
	const scope = {
		table: "real_data_01",
		from: "2026-10-20T12:00:00Z",
		to: "2026-10-27T12:00:00Z",
		records: 151200,
		complete: true,
		sampled: false,
		calculation: "mysql_aggregate_v1",
		bucketSeconds: 3600,
		metrics: [
			{
				metric: "current_actual",
				unit: "A",
				count: 151200,
				missing: 0,
				min: 0.3499999940395355,
				max: 0.8500000238418579,
				mean: 0.6000942592060676,
			},
		],
	};
	const record = {
		...bundle.records[0],
		result: {
			a: scope,
			b: {
				...scope,
				truncated: true,
				metrics: [{ ...scope.metrics[0], count: 0, min: null, max: null, mean: null }],
			},
		},
	};
	const before = JSON.stringify(record);
	const sections = evidenceSections(record);
	assert.deepEqual(
		sections.map((section) => section.title),
		["A 时段", "B 时段"],
	);
	assert.deepEqual(sections[0].metrics[0], {
		label: "实际电流",
		unit: "A",
		count: "151,200",
		missing: "0",
		min: "0.35",
		max: "0.85",
		mean: "0.6",
	});
	assert.match(sections[0].notes.join(""), /每1小时/);
	assert.ok(sections[0].facts.some((fact) => fact.value === "完整查询时段"));
	assert.ok(!sections[1].facts.some((fact) => fact.value === "完整查询时段"));
	assert.match(sections[1].warnings[0], /截断/);
	assert.equal(sections[1].metrics[0].mean, "—");
	assert.equal(JSON.stringify(record), before);
	const chartSections = evidenceSections({
		...record,
		tool: "create_analysis_chart",
		result: {
			title: "电流趋势",
			sourceRecords: 151200,
			displayed: 168,
			sources: [{ table: scope.table, from: scope.from, to: scope.to }],
		},
	});
	assert.ok(
		chartSections.some((section) => section.facts.some((fact) => fact.label === "图表" && fact.value === "电流趋势")),
	);
	assert.ok(chartSections.some((section) => section.facts.some((fact) => fact.label === "数据来源")));
});

test("visible times use seconds while numbers, link targets, code and saved evidence retain precision", () => {
	const content =
		"时间 15:35:48.156，温度 50.156，`2026-10-22T15:35:48.999+08:00`\n\n[15:35:48.156](https://example.com/15:35:48.156)\n\n```json\n15:35:48.156\n```";
	const answer = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkSecondPrecision] }, content));
	assert.equal(timeToSeconds("15:35:48.999，50.156"), "15:35:48，50.156");
	assert.match(answer, /时间 15:35:48，温度 50\.156/);
	assert.match(answer, /<code>2026-10-22T15:35:48\+08:00<\/code>/);
	assert.match(answer, /href="https:\/\/example.com\/15:35:48\.156">15:35:48<\/a>/);
	assert.match(answer, /<pre><code class="language-json">15:35:48\.156/);
	const snapshot = JSON.stringify(bundle);
	const html = analysisReportHtml({ ...message, content }, [], bundle, "查询截至15:35:48.156");
	assert.match(html, /<p>查询截至15:35:48<\/p>/);
	assert.equal(JSON.stringify(bundle), snapshot);
	assert.equal(bundle.records[0].createdAt, "2026-10-22T00:00:00.000Z");
});

test("only labelled limitation paragraphs receive smaller typography, including in reports", () => {
	const content =
		"### 手册出处\n\n书名：测试手册，第378页\n\n**限制说明：** 现场适用性未确认。\n\n正文提到限制说明：保持正文样式。";
	const answer = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkLimitations] }, content));
	assert.match(answer, /<h3>手册出处<\/h3>\n<p>书名：测试手册，第378页<\/p>/);
	assert.match(answer, /<p class="answer-limitation"><strong>限制说明：<\/strong>/);
	assert.match(answer, /<p>正文提到限制说明：保持正文样式。<\/p>/);
	const html = analysisReportHtml({ ...message, content }, [], null);
	assert.match(html, /\.answer-limitation\{font-size:12px\}/);
	assert.equal((html.match(/class="answer-limitation"/g) ?? []).length, 1);
});
