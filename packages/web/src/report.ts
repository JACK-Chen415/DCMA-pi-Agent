import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type ChartArtifact, validateChartArtifact } from "../chart-contracts.ts";
import { type EvidenceBundle, toolLabels } from "../interaction-contracts.ts";
import { renderChartSvg } from "./chart-render.ts";
import { evidenceSummary, loadEvidence } from "./evidence.ts";
import { remarkKnowledgeLinks } from "./remark-knowledge-links.ts";
import { remarkLimitations } from "./remark-limitations.ts";
import { remarkSecondPrecision, timeToSeconds } from "./time-display.ts";
import type { ChatMessage } from "./types.ts";

export function messageReport(message: ChatMessage): string {
	return `# DCMA 对话记录\n\n生成时间：${timeToSeconds(message.timestamp)}\n分析引擎：${message.engine ?? "未指定"}\n\n${message.content}\n`;
}

function escapeHtml(text: string): string {
	return text.replace(
		/[&<>"']/g,
		(character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
	);
}
export function analysisReportHtml(
	message: ChatMessage,
	charts: ChartArtifact[],
	evidence: EvidenceBundle | null,
	question = "",
): string {
	const answer = renderToStaticMarkup(
		createElement(
			Markdown,
			{
				remarkPlugins: [remarkGfm, remarkKnowledgeLinks, remarkSecondPrecision, remarkLimitations],
				skipHtml: true,
				components: { img: () => null },
			},
			message.content,
		),
	);
	const stamp = new Date(message.timestamp).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
	const figures = charts
		.map(
			(chart) =>
				`<section class="figure"><h2>${escapeHtml(timeToSeconds(chart.title))}</h2>${renderChartSvg(chart)}</section>`,
		)
		.join("");
	const records =
		evidence?.records
			.map(
				(record) =>
					`<section class="evidence"><h3>${escapeHtml(toolLabels[record.tool])}</h3><p>记录时间：${escapeHtml(new Date(record.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }))}（北京时间）</p>${evidenceSummary(
						record,
					)
						.map((line) => `<p>${escapeHtml(line)}</p>`)
						.join("")}</section>`,
			)
			.join("") ?? "<p>本条消息没有已保存的查询证据。此说明不能代替数据核验。</p>";
	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>DCMA 分析报告</title><style>body{font:15px/1.8 system-ui,"Microsoft YaHei",sans-serif;color:#1e293b;max-width:1050px;margin:40px auto;padding:0 24px}h1{font-size:28px;color:#0f172a}h2{margin-top:32px;font-size:21px}h3{font-size:17px}header{border-bottom:3px solid #2563eb;padding-bottom:18px}p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#2563eb;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{border:1px solid #cbd5e1;padding:8px 12px;text-align:left}th{background:#f1f5f9}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f8fafc;padding:14px;border:1px solid #e2e8f0}svg{display:block;width:100%;height:auto}.figure,.evidence{border-top:1px solid #e2e8f0;margin-top:24px;padding-top:12px}summary{cursor:pointer;color:#2563eb;padding:10px 0}.answer-limitation{font-size:12px}.note{color:#475569;background:#f1f5f9;padding:12px}@media print{body{margin:0;padding:0;font-size:11pt}header,h2,h3{break-after:avoid}.figure svg{break-inside:avoid}details{display:block}details>pre{display:block}a{color:inherit}}</style></head><body><header><h1>DCMA 工业数据分析报告</h1><p>分析时间：${escapeHtml(stamp)}（北京时间）<br>分析引擎：${escapeHtml(message.engine ?? "未指定")}</p></header>${question ? `<section><h2>分析问题</h2><p>${escapeHtml(timeToSeconds(question))}</p></section>` : ""}<section><h2>分析结论</h2>${answer}</section>${figures}<section><h2>查询与资料证据</h2>${records}</section><p class="note">本报告保存本次回答与查询时的固定快照，不随实时数据更新。图表使用完整快照视野；数据范围、截断、缺失及资料适用条件以证据为准。模型建议不等于已确认的故障根因。浏览器可打开本文件并打印或保存为PDF。</p></body></html>`;
}
export async function completeMessageReport(message: ChatMessage, question = ""): Promise<string> {
	const charts = await Promise.all(
		(message.charts ?? []).map(async (reference) => {
			const response = await fetch(`/api/tools/charts/${reference.id}.json`, { signal: AbortSignal.timeout(15000) });
			if (!response.ok) throw new Error("图表快照不可读取，暂不能生成完整报告。请检查本地服务或归档文件。");
			const chart = validateChartArtifact(await response.json());
			if (chart.id !== reference.id) throw new Error("图表编号不匹配。");
			return chart;
		}),
	);
	const expected = message.steps?.flatMap((step) => (step.evidenceId ? [step.evidenceId] : [])) ?? [];
	const evidence = expected.length ? await loadEvidence(message.id, AbortSignal.timeout(15000)) : null;
	if (evidence && expected.some((id) => !evidence.records.some((record) => record.id === id)))
		throw new Error("查询证据不完整，暂不能生成完整报告。");
	return analysisReportHtml(message, charts, evidence, question);
}
