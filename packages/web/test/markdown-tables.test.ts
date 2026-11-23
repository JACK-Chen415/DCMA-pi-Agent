import assert from "node:assert/strict";
import test from "node:test";
import { repairMarkdownTables } from "../src/markdown-tables.ts";
import { analysisReportHtml, reportMarkdown } from "../src/report.ts";
import type { ChatMessage } from "../src/types.ts";

const message: ChatMessage = {
	id: "22222222-2222-4222-8222-222222222222",
	role: "assistant",
	timestamp: "2026-10-22T00:00:00.000Z",
	status: "done",
	engine: "test",
	content: "结论文本。",
};

test("valid GFM tables are left unchanged", () => {
	const markdown = "| 指标 | 结果 |\n| --- | --- |\n| 最低温度 | -2 |";
	assert.equal(repairMarkdownTables(markdown), markdown);
});

test("rows without a delimiter line become a real GFM table", () => {
	const repaired = repairMarkdownTables("| 指标 | 结果 |\n| 最低温度 | -2 |\n| 最高温度 | 5 |");
	assert.equal(repaired, "| 指标 | 结果 |\n| --- | --- |\n| 最低温度 | -2 |\n| 最高温度 | 5 |");
	const html = analysisReportHtml({ ...message, content: repaired }, [], null);
	assert.match(html, /<table><thead><tr><th>指标<\/th><th>结果<\/th>/);
	assert.match(html, /<td>最低温度<\/td><td>-2<\/td>/);
});

test("full-width pipe separators and missing outer pipes are normalized", () => {
	const repaired = repairMarkdownTables("｜时间｜数值\n16:00｜38.1\n16:30｜39.2");
	assert.equal(repaired, "| 时间 | 数值 |\n| --- | --- |\n| 16:00 | 38.1 |\n| 16:30 | 39.2 |");
});

test("code fences, single pipe lines and prose are not rewritten", () => {
	const markdown = "```text\n| 指标 | 结果 |\n| 最低温度 | -2 |\n```\n\n说明 | 备注\n\n| 单行 |";
	assert.equal(repairMarkdownTables(markdown), markdown);
});

test("tables keep a blank line from surrounding paragraphs", () => {
	const repaired = repairMarkdownTables("表格如下\n| a | b |\n| 1 | 2 |\n后续文字");
	assert.equal(repaired, "表格如下\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后续文字");
});

test("report markdown and HTML both render the repaired table instead of markdown source", () => {
	const content = "## 结论\n\n| 指标 | 数值 |\n| 温度 | 38.1 |\n| 振动 | 0.32 |";
	const markdown = reportMarkdown({ ...message, content }, [], null, "温度是否异常？");
	assert.match(markdown, /^\| 指标 \| 数值 \|$/mu);
	assert.match(markdown, /^\| --- \| --- \|$/mu);
	assert.match(markdown, /^- 分析时间：/mu);
	assert.match(markdown, /## 分析问题\n\n温度是否异常？/u);
	assert.match(markdown, /## 查询与资料证据/u);
	const html = analysisReportHtml({ ...message, content }, [], null, "温度是否异常？");
	assert.match(html, /<table><thead>/);
	assert.doesNotMatch(html.replace(/<[^>]+>/gu, " "), /温度 \| 38\.1/u);
});
