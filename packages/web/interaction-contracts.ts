import { chartIdPattern } from "./chart-contracts.ts";

export const toolLabels: Record<string, string> = {
	list_industrial_tables: "查询数据目录",
	read_industrial_dashboard: "读取设备采样",
	read_industrial_rows: "筛选原始记录",
	get_device_profile: "查看设备资料",
	check_data_quality: "检查数据质量",
	summarize_metrics: "统计指标",
	compare_metric_windows: "比较时间窗口",
	analyze_threshold_events: "分析连续超限",
	get_code_events: "统计故障与报警",
	assess_device_state: "评估设备状态",
	lookup_fault_code: "查阅故障码手册",
	search_maintenance_knowledge: "检索维修资料",
	build_diagnostic_evidence: "整理诊断证据",
	create_analysis_chart: "生成图表",
	export_analysis_report: "导出证据报告",
	get_alert_history: "读取告警记录",
	manage_monitoring_task: "处理监测任务",
};
export interface ToolStep {
	callId: string;
	tool: string;
	status: "running" | "done" | "error";
	durationMs?: number;
	evidenceId?: string;
	/** 工具失败时的原因，最多200字；只用于步骤列表展示。 */
	error?: string;
}
export interface EvidenceRecord {
	id: string;
	tool: string;
	createdAt: string;
	input: unknown;
	result: unknown;
}
export interface EvidenceBundle {
	version: 1;
	requestId: string;
	records: EvidenceRecord[];
}
export function validateToolSteps(value: unknown): ToolStep[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, 16).flatMap((step: unknown) => {
		if (!step || typeof step !== "object") return [];
		const item = step as Record<string, unknown>;
		if (
			typeof item.callId !== "string" ||
			!item.callId ||
			item.callId.length > 128 ||
			typeof item.tool !== "string" ||
			!Object.hasOwn(toolLabels, item.tool) ||
			!["running", "done", "error"].includes(String(item.status))
		)
			return [];
		return [
			{
				callId: item.callId,
				tool: item.tool,
				status: item.status as ToolStep["status"],
				...(typeof item.durationMs === "number" && Number.isFinite(item.durationMs) && item.durationMs >= 0
					? { durationMs: item.durationMs }
					: {}),
				...(typeof item.evidenceId === "string" && chartIdPattern.test(item.evidenceId)
					? { evidenceId: item.evidenceId }
					: {}),
				...(typeof item.error === "string" && item.error.trim() && item.error.length <= 200
					? { error: item.error }
					: {}),
			},
		];
	});
}
export function updateToolSteps(steps: ToolStep[], event: Record<string, unknown>): ToolStep[] {
	if (event.type !== "tool_start" && event.type !== "tool_end") return steps;
	const [step] = validateToolSteps([
		{ ...event, status: event.type === "tool_start" ? "running" : event.ok === true ? "done" : "error" },
	]);
	if (!step) return steps;
	const index = steps.findIndex((item) => item.callId === step.callId);
	if (index < 0) return steps.length < 16 ? [...steps, step] : steps;
	return steps.map((item, position) => (position === index ? { ...item, ...step } : item));
}
export function validateEvidenceBundle(value: unknown, requestId: string): EvidenceBundle {
	if (!value || typeof value !== "object") throw new Error("查询证据格式无效。");
	const bundle = value as Record<string, unknown>;
	if (
		bundle.version !== 1 ||
		bundle.requestId !== requestId ||
		!chartIdPattern.test(requestId) ||
		!Array.isArray(bundle.records) ||
		bundle.records.length > 16
	)
		throw new Error("查询证据编号或版本无效。");
	const ids = new Set<string>();
	for (const record of bundle.records) {
		if (
			!record ||
			typeof record !== "object" ||
			typeof record.id !== "string" ||
			!chartIdPattern.test(record.id) ||
			ids.has(record.id) ||
			typeof record.tool !== "string" ||
			!Object.hasOwn(toolLabels, record.tool) ||
			typeof record.createdAt !== "string" ||
			!Number.isFinite(Date.parse(record.createdAt)) ||
			!("input" in record) ||
			!("result" in record)
		)
			throw new Error("查询证据记录无效。");
		ids.add(record.id);
	}
	return bundle as unknown as EvidenceBundle;
}
