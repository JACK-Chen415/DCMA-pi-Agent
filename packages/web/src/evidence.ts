import { fieldLabels } from "../../../dashboard/database/dashboard-types.ts";
import { type EvidenceBundle, type EvidenceRecord, validateEvidenceBundle } from "../interaction-contracts.ts";
import { chartValue } from "./chart-options.ts";

export async function loadEvidence(requestId: string, signal?: AbortSignal): Promise<EvidenceBundle> {
	const response = await fetch(`/api/tools/evidence/${encodeURIComponent(requestId)}.json`, { signal });
	if (!response.ok) throw new Error("查询证据未保存、已归档或暂不可读取。旧会话不会自动补查数据。");
	return validateEvidenceBundle(await response.json(), requestId);
}
export interface EvidenceSection {
	id: string;
	title: string;
	facts: { label: string; value: string }[];
	metrics: { label: string; unit: string; count: string; missing: string; min: string; max: string; mean: string }[];
	notes: string[];
	warnings: string[];
}

export function evidenceSections(record: EvidenceRecord): EvidenceSection[] {
	const sections: EvidenceSection[] = [];
	const visit = (value: unknown, depth = 0, title = "", path = "result") => {
		if (!value || typeof value !== "object" || depth > 3) return;
		const data = value as Record<string, unknown>;
		const section: EvidenceSection = { id: path, title, facts: [], metrics: [], notes: [], warnings: [] };
		const fact = (label: string, value: string) => section.facts.push({ label, value });
		if (record.tool === "export_analysis_report" && depth === 0) {
			const input =
				record.input && typeof record.input === "object" ? (record.input as Record<string, unknown>) : {};
			if (typeof input.title === "string") fact("报告名称", input.title);
			if (Array.isArray(data.evidenceIds))
				fact(
					"包含内容",
					`${new Set(data.evidenceIds.filter((id) => typeof id === "string")).size} 项查询结果与参考资料`,
				);
		}
		if (typeof data.table === "string")
			fact("数据来源", `${data.table}（${data.table === "real_data" ? "历史采集数据" : "模拟数据"}）`);
		if (typeof data.from === "string" && typeof data.to === "string") {
			const time = (text: string) =>
				Number.isFinite(Date.parse(text))
					? new Date(text).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
					: text;
			fact("时间范围 · 北京时间", `${time(data.from)} ～ ${time(data.to)}`);
		}
		if (typeof data.records === "number") fact("覆盖采样", `${data.records.toLocaleString("zh-CN")} 条`);
		if (data.truncated === true || data.hasMore === true)
			section.warnings.push("此结果有截断或后续记录，不能作为全量统计。");
		else if (data.complete === true) fact("统计范围", "完整查询时段");
		if (data.sampled === false) section.notes.push("统计使用原始采样，均值按采样点计算。");
		if (data.calculation === "mysql_aggregate_v1")
			section.notes.push(
				`数据库计算完整请求时段；趋势每${typeof data.bucketSeconds === "number" && data.bucketSeconds % 3600 === 0 ? `${data.bucketSeconds / 3600}小时` : `${data.bucketSeconds}秒`}汇总，保留均值和极值，缺失时段留空。`,
			);
		if (record.tool === "create_analysis_chart" && depth === 0) {
			if (typeof data.title === "string") fact("图表", data.title);
			if (typeof data.sourceRecords === "number")
				fact("来源采样", `${data.sourceRecords.toLocaleString("zh-CN")} 条`);
			if (typeof data.displayed === "number") fact("图表数据", `${data.displayed.toLocaleString("zh-CN")} 行`);
		}
		if (Array.isArray(data.metrics))
			for (const value of data.metrics) {
				if (!value || typeof value !== "object") continue;
				const entry = value as Record<string, unknown>;
				if (typeof entry.metric !== "string" || typeof entry.count !== "number") continue;
				const label = fieldLabels[entry.metric as keyof typeof fieldLabels] ?? entry.metric;
				section.metrics.push({
					label,
					unit: typeof entry.unit === "string" ? entry.unit : "单位未确认",
					count: entry.count.toLocaleString("zh-CN"),
					missing: typeof entry.missing === "number" ? entry.missing.toLocaleString("zh-CN") : "—",
					min: chartValue(entry.min),
					max: chartValue(entry.max),
					mean: chartValue(entry.mean),
				});
			}
		if (data.condition && typeof data.condition === "object") {
			const condition = data.condition as Record<string, unknown>;
			if (typeof condition.metric === "string" && typeof condition.matched === "number")
				fact(
					"阈值采样点",
					`${fieldLabels[condition.metric as keyof typeof fieldLabels] ?? condition.metric}${condition.operator === "gt" ? "严格大于" : "严格小于"}${chartValue(condition.threshold)}：命中${condition.matched}条，未命中${condition.notMatched}条，缺失${condition.missing}条。这是采样点数。`,
				);
		}
		if (typeof data.title === "string" && typeof data.locator === "string")
			fact(
				"资料出处",
				`${data.title} · ${data.locator}${typeof data.revision === "string" ? ` · ${data.revision}` : ""}`,
			);
		if (typeof data.text === "string") section.notes.push(`资料原文：${data.text}`);
		else if (typeof data.excerpt === "string") section.notes.push(`资料摘录：${data.excerpt}`);
		if (section.facts.length || section.metrics.length || section.notes.length || section.warnings.length)
			sections.push(section);
		for (const key of ["source", "a", "b", "quality", "statistics", "events"])
			visit(data[key], depth + 1, key === "a" ? "A 时段" : key === "b" ? "B 时段" : title, `${path}.${key}`);
		for (const key of ["sources", "matches"])
			if (Array.isArray(data[key]))
				for (const [index, item] of data[key].entries()) visit(item, depth + 1, title, `${path}.${key}.${index}`);
	};
	visit(record.result);
	return sections;
}

export function evidenceSummary(record: EvidenceRecord): string[] {
	return [
		...new Set(
			evidenceSections(record).flatMap((section) => [
				...(section.title ? [section.title] : []),
				...section.facts.map((fact) => `${fact.label}：${fact.value}`),
				...section.warnings,
				...section.metrics.map(
					(metric) =>
						`${metric.label}（${metric.unit}）：有效${metric.count}条，缺失${metric.missing}条；最小${metric.min}，最大${metric.max}，均值${metric.mean}。`,
				),
				...section.notes,
			]),
		),
	];
}
