import { type EvidenceBundle, type EvidenceRecord, validateEvidenceBundle } from "../interaction-contracts.ts";

export async function loadEvidence(requestId: string, signal?: AbortSignal): Promise<EvidenceBundle> {
	const response = await fetch(`/api/tools/evidence/${encodeURIComponent(requestId)}.json`, { signal });
	if (!response.ok) throw new Error("查询证据未保存、已归档或暂不可读取。旧会话不会自动补查数据。");
	return validateEvidenceBundle(await response.json(), requestId);
}
export function evidenceSummary(record: EvidenceRecord): string[] {
	const lines: string[] = [];
	const visit = (value: unknown, depth = 0) => {
		if (!value || typeof value !== "object" || depth > 3) return;
		const data = value as Record<string, unknown>;
		if (typeof data.table === "string")
			lines.push(`数据来源：${data.table}（${data.table === "real_data" ? "历史采集数据" : "模拟数据"}）`);
		if (typeof data.from === "string" && typeof data.to === "string") {
			const time = (text: string) =>
				Number.isFinite(Date.parse(text))
					? new Date(text).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
					: text;
			lines.push(`北京时间：${time(data.from)} ～ ${time(data.to)}`);
		}
		if (typeof data.records === "number") lines.push(`覆盖采样：${data.records} 条`);
		if (data.truncated === true || data.hasMore === true) lines.push("此结果有截断或后续记录，不能作为全量统计。");
		if (data.complete === true) lines.push("统计覆盖本次查询的完整受限窗口。");
		if (data.sampled === false) lines.push("统计使用原始采样，均值按采样点计算。");
		if (Array.isArray(data.metrics))
			for (const value of data.metrics) {
				if (!value || typeof value !== "object") continue;
				const entry = value as Record<string, unknown>;
				if (typeof entry.metric !== "string" || typeof entry.count !== "number") continue;
				const label = fieldLabels[entry.metric as keyof typeof fieldLabels] ?? entry.metric;
				const number = (value: unknown) => (typeof value === "number" ? String(value) : "未知");
				lines.push(
					`${label}：有效${entry.count}条，缺失${number(entry.missing)}条；最小${number(entry.min)}，最大${number(entry.max)}，均值${number(entry.mean)}。`,
				);
			}
		if (data.condition && typeof data.condition === "object") {
			const condition = data.condition as Record<string, unknown>;
			if (typeof condition.metric === "string" && typeof condition.matched === "number")
				lines.push(
					`${fieldLabels[condition.metric as keyof typeof fieldLabels] ?? condition.metric}${condition.operator === "gt" ? "严格大于" : "严格小于"}${condition.threshold}：命中${condition.matched}条，未命中${condition.notMatched}条，缺失${condition.missing}条。这是采样点数。`,
				);
		}
		if (typeof data.title === "string" && typeof data.locator === "string")
			lines.push(
				`资料出处：${data.title} · ${data.locator}${typeof data.revision === "string" ? ` · ${data.revision}` : ""}`,
			);
		if (typeof data.text === "string") lines.push(`资料原文：${data.text}`);
		else if (typeof data.excerpt === "string") lines.push(`资料摘录：${data.excerpt}`);
		for (const key of ["source", "a", "b", "quality", "statistics", "events"]) visit(data[key], depth + 1);
		if (Array.isArray(data.matches)) for (const match of data.matches) visit(match, depth + 1);
	};
	visit(record.result);
	return [...new Set(lines)];
}

import { fieldLabels } from "../../../dashboard/database/dashboard-types.ts";
