import { Type } from "typebox";
import { Check } from "typebox/value";
import { fieldLabels, type NumericField, numericFields } from "../../../dashboard/database/dashboard-types.ts";
import type { EvidenceRecord } from "../interaction-contracts.ts";
import { ToolInputError } from "./contracts.ts";

const claimKinds = [
	"conclusion",
	"process",
	"hypothesis",
	"recommendation",
	"metric_summary",
	"trend",
	"events",
	"event_pattern",
	"condition_count",
	"threshold",
	"continuity",
	"comparison",
	"manual",
	"state",
	"reading",
	"stability_ranking",
	"relative_level",
	"event_alignment",
] as const;
export const analysisPlanSchema = Type.Object(
	{
		format: Type.Union([Type.Literal("brief"), Type.Literal("report")]),
		claims: Type.Array(
			Type.Object(
				{
					kind: Type.Union(claimKinds.map((kind) => Type.Literal(kind))),
					evidenceId: Type.String({ pattern: "^[0-9a-f-]{36}$" }),
					metric: Type.Optional(Type.Union(numericFields.map((metric) => Type.Literal(metric)))),
					code: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
					itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
					field: Type.Optional(Type.Union([Type.Literal("fault_code"), Type.Literal("alarm_code")])),
					text: Type.Optional(Type.String({ minLength: 1, maxLength: 600 })),
				},
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: 24 },
		),
	},
	{ additionalProperties: false },
);
interface AnalysisPlan {
	format: "brief" | "report";
	claims: {
		kind: (typeof claimKinds)[number];
		evidenceId: string;
		metric?: NumericField;
		code?: string;
		itemId?: string;
		field?: "fault_code" | "alarm_code";
		text?: string;
	}[];
}
type Claim = AnalysisPlan["claims"][number];
type Data = Record<string, unknown>;
const analysisTools = new Set([
	"summarize_metrics",
	"get_code_events",
	"compare_metric_windows",
	"check_data_quality",
	"analyze_threshold_events",
	"assess_device_state",
	"build_diagnostic_evidence",
	"read_industrial_dashboard",
	"read_industrial_rows",
]);
const fallbackKinds: Partial<Record<string, Claim["kind"]>> = {
	summarize_metrics: "metric_summary",
	get_code_events: "events",
	check_data_quality: "continuity",
	analyze_threshold_events: "threshold",
	compare_metric_windows: "comparison",
	assess_device_state: "state",
	read_industrial_dashboard: "reading",
	read_industrial_rows: "reading",
	search_fault_knowledge: "manual",
	lookup_fault_code: "manual",
	build_diagnostic_evidence: "metric_summary",
};

/** Qualitative, model-authored claims. They may not carry numbers or codes; those stay in typed claims. */
const narrativeLabels = {
	conclusion: "结论",
	process: "过程分析",
	hypothesis: "候选原因（待验证）",
	recommendation: "建议核查",
} as const;
const narrativeKinds = new Set<string>(Object.keys(narrativeLabels));
const narrativeEvidenceTools = new Set<string>([
	...analysisTools,
	"search_fault_knowledge",
	"lookup_fault_code",
	"get_device_profile",
	"list_fault_knowledge_sources",
]);
const absoluteHealthClaim = /^(?:设备|电机|系统|机组)?(?:运行)?(?:正常|健康|无异常)|^一切正常/;

function hasRunningState(records: EvidenceRecord[]): boolean {
	return records.some((record) => {
		const result = record.result as Data | null;
		if (!result || typeof result !== "object") return false;
		if (record.tool === "assess_device_state") return result.currentState === "running";
		if (record.tool === "build_diagnostic_evidence") {
			const state = result.state as Data | undefined;
			return Boolean(state && state.currentState === "running");
		}
		return false;
	});
}

function narrativeText(claim: Claim, records: EvidenceRecord[]): string {
	const raw = claim.text?.trim() ?? "";
	if (!raw)
		throw new ToolInputError(`${narrativeLabels[claim.kind as keyof typeof narrativeLabels]}结论必须提供text。`);
	if (raw.length > 600) throw new ToolInputError("分析文字过长，请控制在600字以内。");
	// 设备、代码和场景标识（F07900、g120_sim_v1、CU250）允许出现；纯数值、时刻和持续时间仍由数据结论生成。
	const withoutIdentifiers = raw.replace(/(?=[A-Za-z_-]*\d)[A-Za-z_][A-Za-z0-9_-]*/g, " ");
	if (/\d/.test(withoutIdentifiers))
		throw new ToolInputError(
			"结论、过程、原因和建议只写定性文字，不写具体数值、时刻或持续时间；数值与时间由metric_summary、events、threshold等结论类型生成。",
		);
	if (
		["conclusion", "process", "hypothesis"].includes(claim.kind) &&
		(absoluteHealthClaim.test(raw) || /运行状态|正在运行|持续运行|处于运行/.test(raw)) &&
		!hasRunningState(records)
	)
		throw new ToolInputError(
			"尚无状态评估证据，不能写设备正常或处于运行状态；请引用assess_device_state或综合证据包的state结论，或只描述观测到的迹象。",
		);
	if (claim.kind === "hypothesis" || claim.kind === "recommendation") {
		const items = raw.split(
			/(?:^|(?<=[。！？；\n]))\s*(?:候选[一二三四五六七八九十]+[：:]|[一二三四五六七八九十]+、)\s*/u,
		);
		return items
			.filter((item) => item.trim())
			.map((item) => text(item.trim()))
			.join("\n");
	}
	return text(raw);
}

function object(value: unknown): Data {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ToolInputError("证据结构无效，无法生成该结论。");
	return value as Data;
}
function list(value: unknown): Data[] {
	if (!Array.isArray(value)) throw new ToolInputError("证据没有所需明细。");
	return value.map(object);
}
function number(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolInputError("证据没有有效数值，不能视为0。");
	return value;
}
function format(value: unknown): string {
	const numeric = number(value);
	return Number.isInteger(numeric)
		? String(numeric)
		: numeric.toLocaleString("zh-CN", { maximumSignificantDigits: 4, useGrouping: false });
}
function text(value: unknown): string {
	return String(value ?? "")
		.replace(/[\r\n]+/g, " ")
		.replace(/[\\`*{}[\]<>#|!]/g, "\\$&");
}
function time(value: unknown): string {
	const instant = typeof value === "string" ? Date.parse(value) : Number.NaN;
	if (!Number.isFinite(instant)) throw new ToolInputError("证据没有有效时间。");
	return new Date(instant + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
}
function scoped(data: Data): string {
	return `${text(data.device ?? "当前设备")}，${text(data.kind === "simulation" ? "模拟数据" : "历史采集数据")}；北京时间${time(data.from)}至${time(data.to)}`;
}

function manualText(record: EvidenceRecord, item: Data): string {
	const source =
		record.tool === "search_fault_knowledge"
			? { title: item.source_file, locator: item.locator }
			: object(item.source);
	const citation = `依据《${text(source.title)}》${text(source.locator)}，${text(item.title ?? `${item.code}：${item.meaning}`)}。${item.context_complete === false ? "该条目未完整取得。" : ""}${
		item.applicability === "reference_only" ? "该条目来自其它设备系列，仅作参考，现场适用性未确认。" : ""
	}`;
	if (
		record.tool !== "search_fault_knowledge" ||
		!["motor_manual", "fault_simulation_plan"].includes(String(item.kind))
	)
		return citation;
	if (typeof item.text !== "string" || !item.text.trim())
		throw new ToolInputError("资料正文未取得，不能仅用章节标题交付内容。");
	const excerpt = item.text.trim();
	return `${citation}\n\n资料摘录${excerpt.length > 2000 ? "（仅显示前2000字符，内容有截断）" : ""}：\n\n${excerpt
		.slice(0, 2000)
		.split(/\r?\n/)
		.map((line) => `> ${text(line)}`)
		.join(
			"\n",
		)}\n\n${item.kind === "fault_simulation_plan" ? "以上为故障模拟试验方案，不代表当前设备已发生该故障；实施前须由现场人员确认条件与安全规程。" : "以上为资料要求，现场适用性仍需核对设备型号与实际条件。"}`;
}
function selectedMetrics(data: Data, claim: Claim): Data[] {
	const metrics = list(data.metrics).filter((metric) => !claim.metric || metric.metric === claim.metric);
	if (!metrics.length) throw new ToolInputError("该证据不包含所选指标。");
	return metrics;
}
function label(metric: Data): string {
	const name = fieldLabels[metric.metric as keyof typeof fieldLabels];
	if (!name) throw new ToolInputError("证据测点无效。");
	return name;
}

function formatWithUnit(metric: Data, value: number): string {
	return `${format(value)}${metric.unit ? text(metric.unit) : "单位未取得"}`;
}

/** Only typed, evidence-backed facts reach this renderer; no model-authored prose or numbers are accepted. */
export function renderAnalysis(value: unknown, records: EvidenceRecord[]): string {
	if (!Check(analysisPlanSchema, value))
		throw new ToolInputError("交付结构无效；仅提交format和claims，不接受自由正文、标题、数值或评分。");
	const plan = value as AnalysisPlan;
	const byId = new Map(records.map((record) => [record.id, record]));
	const sections: { title: string; body: string; scope?: Data }[] = [];
	const narrativeSections: { kind: string; title: string; body: string }[] = [];
	const scopes = new Map<string, Data>();
	const limits = new Set<string>();
	const citedManuals = new Set<string>();
	const citeManual = (record: EvidenceRecord, item: Data) => {
		const citation = manualText(record, item);
		if (citedManuals.has(citation)) return "";
		citedManuals.add(citation);
		return citation;
	};
	const manualLimit = "手册释义须核对现场型号、驱动对象与版本；涉及参数修改时按现场规程执行。";
	const unitFor = (table: unknown, metric: string) => {
		const reading = records.find(
			(record) => record.tool === "read_industrial_dashboard" && object(record.result).table === table,
		);
		if (reading && object(reading.result).units) return object(object(reading.result).units)[metric];
		const profile = records.find(
			(record) => record.tool === "get_device_profile" && object(record.result).table === table,
		);
		return profile ? list(object(profile.result).measurements).find((item) => item.field === metric)?.unit : null;
	};
	const scopeOf = (data: Data): Data | undefined =>
		typeof data.table === "string" && typeof data.from === "string" && typeof data.to === "string" ? data : undefined;
	const assertTable = (table: string) => {
		for (const scope of scopes.values())
			if (scope.table !== table) throw new ToolInputError("所选结论混用了设备；请分别引用同一设备的证据。");
	};
	const recordScope = (data: Data) => {
		const scope = scopeOf(data);
		if (!scope) return;
		assertTable(String(scope.table));
		scopes.set(JSON.stringify([scope.table, Date.parse(String(scope.from)), Date.parse(String(scope.to))]), scope);
	};
	const renderedSummaries = new Set<string>();
	for (const claim of plan.claims) {
		const record = byId.get(claim.evidenceId);
		if (!record) throw new ToolInputError("证据不存在或不属于本轮请求。");
		if (narrativeKinds.has(claim.kind)) {
			if (!narrativeEvidenceTools.has(record.tool))
				throw new ToolInputError("结论、过程、原因和建议必须引用本轮的数据或资料证据。");
			narrativeSections.push({
				kind: claim.kind,
				title: narrativeLabels[claim.kind as keyof typeof narrativeLabels],
				body: narrativeText(claim, records),
			});
			continue;
		}
		let data = object(record.result);
		if (claim.kind === "stability_ranking")
			throw new ToolInputError("尚无适用的统一比较方法及计算结果，不能交付稳定性排名；请改为各指标自身范围。");
		if (claim.kind === "relative_level")
			throw new ToolInputError("均值和范围不能证明偏高或偏低；请引用已计算的threshold或condition_count结论。");
		if (claim.kind === "event_alignment")
			throw new ToolInputError("尚无报警区间对齐分析结果，不能判断报警期间指标是否偏离。");
		if (record.tool === "build_diagnostic_evidence") {
			const part =
				claim.kind === "continuity"
					? "quality"
					: claim.kind === "state"
						? "state"
						: ["events", "event_pattern"].includes(claim.kind)
							? "events"
							: "statistics";
			if (part === "state" && !data.state) throw new ToolInputError("综合证据没有状态结果，不能交付状态结论。");
			data = object(data[part]);
		}
		const allow = (...tools: string[]) => {
			if (!tools.includes(record.tool) && record.tool !== "build_diagnostic_evidence")
				throw new ToolInputError(`该证据不能支持${claim.kind}结论。`);
		};
		let body = "",
			title = "";
		if (claim.kind === "metric_summary" || claim.kind === "trend" || claim.kind === "condition_count") {
			allow("summarize_metrics");
			recordScope(data);
			limits.add("查询覆盖时段不等于连续采样。");
			if (claim.kind === "condition_count") {
				const condition = object(data.condition);
				const metric = selectedMetrics(data, { ...claim, metric: condition.metric as Claim["metric"] })[0];
				if (!["gt", "lt"].includes(String(condition.operator))) throw new ToolInputError("条件计数运算无效。");
				body = `${label(metric)}严格${condition.operator === "gt" ? "大于" : "小于"}${format(condition.threshold)}的采样点为${format(condition.matched)}个，有效${format(condition.valid)}个、缺失${format(condition.missing)}个；采样点数不等于连续事件次数。`;
				title = "条件统计";
			} else {
				let metrics = selectedMetrics(data, claim);
				if (claim.kind === "metric_summary") {
					if (renderedSummaries.has(claim.evidenceId)) continue;
					renderedSummaries.add(claim.evidenceId);
					const related = plan.claims.filter(
						(item) => item.kind === "metric_summary" && item.evidenceId === claim.evidenceId,
					);
					metrics = [
						...new Map(
							related.flatMap((item) => selectedMetrics(data, item)).map((item) => [item.metric, item]),
						).values(),
					];
				}
				title = claim.kind === "trend" ? "汇总趋势" : "关键指标";
				if (claim.kind === "trend") {
					const step = number(data.bucketSeconds);
					body = metrics
						.map((metric) => {
							let means: number[];
							if (data.trend) {
								const trend = object(data.trend);
								const columns = trend.columns as string[];
								const index = columns.indexOf(`${metric.metric}.mean`);
								means = (trend.rows as unknown[][])
									.map((row) => row[index])
									.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
							} else
								means = list(data.buckets).flatMap((bucket) =>
									list(bucket.metrics)
										.filter((entry) => entry.metric === metric.metric && typeof entry.mean === "number")
										.map((entry) => number(entry.mean)),
								);
							if (!means.length) return `${label(metric)}没有可用的汇总趋势。`;
							const coverage = data.trend && object(data.trend).sampled ? "预览所含时段的" : "";
							return `${label(metric)}${coverage}每${format(step / 60)}分钟汇总均值为${format(Math.min(...means))}～${format(Math.max(...means))}${metric.unit ? text(metric.unit) : "，单位未取得"}。`;
						})
						.join(" ");
					limits.add("汇总趋势只说明对应时间尺度。");
					if (data.trend && object(data.trend).sampled) limits.add("汇总趋势已降采样，只显示部分时段。");
				} else if (plan.format === "report") {
					const rows = metrics
						.map(
							(metric) =>
								`| ${label(metric)} | ${metric.mean === null ? "无有效值" : formatWithUnit(metric, metric.mean as number)} | ${metric.min === null ? "—" : formatWithUnit(metric, metric.min as number)} | ${metric.max === null ? "—" : formatWithUnit(metric, metric.max as number)} | ${format(metric.count)}/${format(metric.missing)} |`,
						)
						.join("\n");
					body = `| 指标 | 均值 | 最小值 | 最大值 | 有效/缺失 |\n| --- | --- | --- | --- | --- |\n${rows}`;
				} else if (metrics.length > 1) {
					const rows = metrics
						.map(
							(metric) =>
								`| ${label(metric)} | ${metric.mean === null ? "无有效值" : formatWithUnit(metric, metric.mean as number)} | ${metric.min === null ? "—" : formatWithUnit(metric, metric.min as number)} | ${metric.max === null ? "—" : formatWithUnit(metric, metric.max as number)} |`,
						)
						.join("\n");
					body = `| 指标 | 均值 | 最小值 | 最大值 |\n| :--- | ---: | ---: | ---: |\n${rows}`;
				} else
					body = `${metrics
						.map((metric) =>
							metric.mean === null
								? `${label(metric)}没有有效采样`
								: `${label(metric)}平均${formatWithUnit(metric, metric.mean as number)}，范围${formatWithUnit(metric, metric.min as number)}～${formatWithUnit(metric, metric.max as number)}`,
						)
						.join("；")}。`;
			}
			const hasState = records.some(
				(entry) =>
					entry.tool === "assess_device_state" ||
					entry.tool === "analyze_threshold_events" ||
					(entry.tool === "build_diagnostic_evidence" && Boolean((entry.result as Data).state)),
			);
			if (!hasState) limits.add("以上为观测值，未按规则判定设备状态。");
		} else if (claim.kind === "events" || claim.kind === "event_pattern") {
			allow("get_code_events");
			recordScope(data);
			title = "故障与报警";
			if (claim.kind === "events") {
				body = `故障事件${data.faults === null ? "数量未知" : `${format(data.faults)}次`}，报警事件${data.alarms === null ? "数量未知" : `${format(data.alarms)}次`}；未结束事件${data.open === null ? "数量未知" : `${format(data.open)}次`}。`;
				const codesList = list(data.codes);
				if (codesList.length > 0) {
					const rows = codesList
						.map((entry) => {
							const definitions = records.flatMap((source) => {
								if (!["search_fault_knowledge", "lookup_fault_code"].includes(source.tool)) return [];
								const result = object(source.result);
								return list(source.tool === "search_fault_knowledge" ? result.results : result.matches)
									.filter((item) =>
										source.tool === "search_fault_knowledge"
											? Array.isArray(item.codes) && item.codes.includes(entry.code)
											: item.code === entry.code &&
												object(source.input).kind === (entry.field === "fault_code" ? "fault" : "alarm"),
									)
									.map((item) => citeManual(source, item));
							});
							const meaning = definitions.length
								? definitions.filter(Boolean).join(" ")
								: "含义未确认，尚未取得适用的手册解释。";
							const type = entry.field === "fault_code" ? "故障" : "报警";
							const duration = `${format(number(entry.durationMs) / 3600000)}小时`;
							const avg = `${format(number(entry.durationMs) / number(entry.count) / 60000)}分钟`;
							return `| ${type} | \`${text(entry.code)}\` | ${format(entry.count)}次 | ${duration} | ${avg} | ${meaning} |`;
						})
						.join("\n");
					body += `\n\n| 类型 | 代码 | 频次 | 累计跨度 | 平均时长 | 手册依据 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n${rows}`;
				}
				if (list(data.codes).length) limits.add(manualLimit);
			} else {
				if (!claim.code) throw new ToolInputError("event_pattern必须指定证据中的原码code。");
				const events = list(data.events)
					.filter((event) => event.code === claim.code && (!claim.field || event.field === claim.field))
					.sort((a, b) => Date.parse(String(a.startedAt)) - Date.parse(String(b.startedAt)));
				if (events.length < 2) throw new ToolInputError("本页该代码明细不足2条，不能计算间隔规律。");
				if (new Set(events.map((event) => event.field)).size > 1)
					throw new ToolInputError("同一码出现在故障和报警两类明细中，请指定field后分别分析。");
				const intervals = events
					.slice(1)
					.map(
						(event, index) =>
							(Date.parse(String(event.startedAt)) - Date.parse(String(events[index].startedAt))) / 60000,
					);
				body = `本次已查看的${events.length}条${text(claim.code)}事件，起点范围为北京时间${time(events[0].startedAt)}至${time(events.at(-1)!.startedAt)}，相邻起点间隔为${format(Math.min(...intervals))}～${format(Math.max(...intervals))}分钟；此规律仅限这些明细，不推广到未查看事件，也不据此推断配置原因。`;
			}
			limits.add("事件跨度不等于停机时长；零事件不等于设备健康。");
		} else if (claim.kind === "manual") {
			allow("search_fault_knowledge", "lookup_fault_code");
			const items = list(record.tool === "search_fault_knowledge" ? data.results : data.matches).filter(
				(item) => !claim.itemId || item.id === claim.itemId,
			);
			if (!items.length) throw new ToolInputError("没有可引用的手册条目，不能补造释义。");
			body = items
				.map((item) => citeManual(record, item))
				.filter(Boolean)
				.join(" ");
			limits.add(manualLimit);
			if (items.some((item) => item.applicability === "reference_only"))
				limits.add("参考手册与查询型号不属于同一设备系列，现场适用性未确认。");
			title = "手册依据";
		} else if (claim.kind === "continuity") {
			allow("check_data_quality");
			recordScope(data);
			title = "采样连续性";
			body =
				number(data.records) === 0
					? "没有可用于连续性检查的采样。"
					: `按最大采样间隔${format(data.maxGapSeconds)}秒检查，发现${format(data.gapCount)}处内部间断、${format(data.duplicateRows)}条重复时间记录；首端空档${format(data.leadingGapSeconds)}秒、尾端空档${format(data.trailingGapSeconds)}秒。此结论仅针对该时段及所用间隔标准。`;
		} else if (claim.kind === "threshold") {
			allow("analyze_threshold_events");
			recordScope(data);
			title = "阈值分析";
			const rule = object(data.rule),
				aggregate = object(data.aggregate);
			const unit = unitFor(data.table, String(rule.metric));
			if (unit && unit !== rule.unit) throw new ToolInputError("阈值单位与设备资料不一致，不能交付超限判断。");
			body = `${text(fieldLabels[rule.metric as keyof typeof fieldLabels])}按${rule.operator === "gt" ? "大于" : "小于"}${format(rule.threshold)}${text(rule.unit)}、至少${format(rule.minDurationSeconds)}秒的规则，确认${format(aggregate.qualifiedCount)}次满足条件的事件，累计观察跨度${format(number(aggregate.qualifiedDurationSeconds) / 60)}分钟；单项规则结果不代表设备整体健康。`;
		} else if (claim.kind === "comparison") {
			allow("compare_metric_windows");
			title = "时段对比";
			const a = object(data.a),
				b = object(data.b);
			if (a.table !== b.table) throw new ToolInputError("不能混用设备进行窗口比较。");
			assertTable(String(a.table));
			const comparisons = list(data.comparisons).filter((entry) => !claim.metric || entry.metric === claim.metric);
			if (!comparisons.length) throw new ToolInputError("比较证据不包含所选指标。");
			const differences = comparisons
				.map((entry) => {
					const first = list(a.metrics).find((metric) => metric.metric === entry.metric);
					const last = list(b.metrics).find((metric) => metric.metric === entry.metric);
					if (!first || !last || first.unit !== last.unit)
						throw new ToolInputError("对比测点或单位不一致，不能交付差值。");
					if (entry.meanA === null || entry.meanB === null)
						return `${label(first)}至少一个时段没有有效值，不能计算均值差。`;
					return `${label(first)}均值由${format(entry.meanA)}变为${format(entry.meanB)}，B减A为${format(entry.meanDelta)}；差异不证明原因。`;
				})
				.join(" ");
			body = `A时段：北京时间${time(a.from)}至${time(a.to)}；B时段：北京时间${time(b.from)}至${time(b.to)}。${differences}`;
		} else if (claim.kind === "state") {
			allow("assess_device_state");
			recordScope(data);
			title = "状态判断";
			const names: Record<string, string> = {
				unknown: "尚无法确认",
				running: "运行",
				stopped: "停止",
				fault: "故障",
			};
			const rule = data.ruleSource ? object(data.ruleSource) : null;
			const observed =
				data.observedState && data.observedState !== data.currentState
					? `窗口内观测状态为${names[String(data.observedState)] ?? "尚无法确认"}；`
					: "";
			body = `本次状态评估：${names[String(data.currentState)] ?? "尚无法确认"}。${observed}${
				rule ? `规则来源：${text(rule.source)}（${text(rule.version)}）。` : "尚无适用的状态规则。"
			}${data.historicalWindowOnly ? "该窗口不是当前时段，不能作为当前状态。" : ""}`;
		} else if (claim.kind === "reading") {
			allow("read_industrial_dashboard", "read_industrial_rows");
			title = "采样读数";
			if (record.tool === "read_industrial_dashboard") {
				const latest = object(data.latest),
					values = object(latest.values);
				const fields = claim.metric ? [claim.metric] : (["motor_temp", "current_actual", "speed_actual"] as const);
				const readings = fields
					.map(
						(field) =>
							`${fieldLabels[field]}${values[field] == null ? "未取得" : `${format(values[field])}${text(unitFor(data.table, field) ?? "（单位未取得）")}`}`,
					)
					.join("；");
				body = `采集于北京时间${time(latest.acquiredAt)}：${readings}。最近采样不代表全时段统计或设备整体健康。`;
			} else {
				const rows = list(data.rows);
				const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
				body = `本次返回${rows.length}条原始记录，下面展示其中${Math.min(rows.length, 50)}条；预览不是完整时段统计。\n\n`;
				if (rows.length && columns.length)
					body += `| ${columns
						.map((key) => {
							const name = fieldLabels[key as keyof typeof fieldLabels] ?? text(key);
							if (!numericFields.includes(key as NumericField)) return name;
							const unit = data.units ? object(data.units)[key] : null;
							return `${name}（${unit ? text(unit) : "单位未取得"}）`;
						})
						.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |\n${rows
						.slice(0, 50)
						.map(
							(row) =>
								`| ${columns
									.map((key) => {
										const value = row[key];
										if (typeof value === "number" && Number.isFinite(value)) {
											// Epoch-millisecond timestamps render as Beijing time; floats keep 4 digits.
											if (value >= 1000000000000) return time(new Date(value).toISOString());
											return text(Number.isInteger(value) ? value : Number(value.toPrecision(4)));
										}
										return text(value ?? "—");
									})
									.join(" | ")} |`,
						)
						.join("\n")}`;
			}
		} else throw new ToolInputError("尚不支持该结论类型。");
		if (body) sections.push({ title, body, scope: scopeOf(data) });
	}
	const scopeList = [...scopes.values()];
	const singleScope = scopeList.length === 1 ? scopeList[0] : undefined;
	const range = singleScope
		? `${scoped(singleScope)}。${typeof singleScope.records === "number" ? `本次统计${format(singleScope.records)}条记录。` : ""}`
		: "";
	if (narrativeSections.some((section) => section.kind === "hypothesis"))
		limits.add("候选原因均为待验证假设，不能作为已确认故障。");
	if (narrativeSections.some((section) => section.kind === "recommendation"))
		limits.add("建议仅为核查动作，不代表已完成处置。");
	const ordered = [
		...narrativeSections.filter((section) => section.kind === "conclusion"),
		...sections,
		...narrativeSections.filter((section) => section.kind === "process"),
		...narrativeSections.filter((section) => section.kind === "hypothesis" || section.kind === "recommendation"),
	];
	const merged: { title: string; text: string; list?: "ordered" | "unordered" }[] = [];
	for (const section of ordered) {
		const scope = "scope" in section ? section.scope : undefined;
		const prefix = scopeList.length > 1 && scope ? `时间：${time(scope.from)}至${time(scope.to)}\n\n` : "";
		const previous = merged.at(-1);
		const kind = "kind" in section ? section.kind : undefined;
		const list = kind === "recommendation" ? "ordered" : kind === "hypothesis" ? "unordered" : undefined;
		if (previous && previous.title === section.title && previous.list === list && !prefix)
			previous.text += `${list ? "\n" : "\n\n"}${section.body}`;
		else merged.push({ title: section.title, text: `${prefix}${section.body}`, list });
	}
	const content = merged
		.map((section) => {
			const body = section.list
				? section.text
						.split("\n")
						.map((item, index) => `${section.list === "ordered" ? `${index + 1}.` : "-"} ${item}`)
						.join("\n")
				: section.text;
			const heading =
				plan.format === "report" || (merged.length > 1 && section.title !== narrativeLabels.conclusion);
			return heading ? `## ${section.title}\n\n${body}` : body;
		})
		.join("\n\n");
	const attachments = records
		.filter((record) => record.tool === "export_analysis_report")
		.flatMap((record) => {
			const result = object(record.result);
			return [
				["Markdown数据附件", result.markdownUrl],
				["JSON数据附件", result.jsonUrl],
			].flatMap(([name, url]) =>
				typeof url === "string" && /^\/api\/tools\/reports\/[0-9a-f-]{36}\.(md|json)$/.test(url)
					? [`[${name}](${url})`]
					: [],
			);
		});
	for (const record of records.filter((entry) => entry.tool === "manage_monitoring_task")) {
		const result = object(record.result);
		if (
			result.status === "pending_confirmation" &&
			typeof result.approvalPath === "string" &&
			/^\/api\/monitoring\/confirm\/[0-9a-f-]{36}$/.test(result.approvalPath)
		)
			attachments.push(`后台监测操作尚未启用，请核对后[确认监测操作](${result.approvalPath})。`);
	}
	const rangeLine = range ? `> 分析时段：${range}` : "";
	const caution = [...limits].some((limit) => limit.includes("不属于同一设备系列")) ? "\u26a0\ufe0f " : "";
	const limitLine = limits.size ? `> 限制说明：${caution}${[...limits].join(" ")}` : "";
	const answer =
		plan.format === "report"
			? `# 设备运行分析报告\n\n${rangeLine ? `${rangeLine}\n\n` : ""}${content}${limitLine ? `\n\n${limitLine}` : ""}${attachments.length ? `\n\n${attachments.join(" · ")}` : ""}`
			: `${content}${rangeLine ? `\n\n${rangeLine}` : ""}${limitLine ? `\n\n${limitLine}` : ""}${attachments.length ? `\n\n${attachments.join(" · ")}` : ""}`;
	if (Buffer.byteLength(answer) > 40000) throw new ToolInputError("交付内容过长，请减少重复结论。");
	return answer;
}

/** Per-request gate. Draft text is buffered until the server knows whether analysis tools were used. */
export function createAnswerDelivery() {
	const records: EvidenceRecord[] = [];
	const validated = new WeakMap<object, string>();
	let required = false,
		accepted: string | undefined,
		attempts = 0;
	return {
		get required() {
			return required;
		},
		get exhausted() {
			return attempts >= 3;
		},
		start(tool: string) {
			if (analysisTools.has(tool) || tool === "submit_analysis") required = true;
		},
		record(record: EvidenceRecord) {
			if (record.tool === "submit_analysis") {
				const answer = validated.get(object(record.result));
				if (!answer) throw new ToolInputError("该交付结果未经本轮校验。");
				accepted = answer;
			}
			records.push(record);
		},
		submit(plan: unknown) {
			required = true;
			if (++attempts > 3) throw new ToolInputError("交付校验未通过，已用完修正机会。");
			const result = { text: renderAnalysis(plan, records), validated: true };
			validated.set(result, result.text);
			return result;
		},
		finish(draft: string): string {
			if (!required) return draft;
			if (accepted) return accepted;
			const claims: Claim[] = records.flatMap((record) => {
				const kind = fallbackKinds[record.tool];
				return kind ? [{ kind, evidenceId: record.id }] : [];
			});
			// Each fallback fact is rendered independently so one unavailable result cannot hide the others.
			const facts = claims.flatMap((claim) => {
				try {
					return [renderAnalysis({ format: "brief", claims: [claim] }, records)];
				} catch {
					return [];
				}
			});
			return `本次完整分析未通过交付校验，以下仅列可核对的查询结果。\n\n${
				facts.length
					? facts.slice(0, 4).join("\n\n")
					: "尚未取得可交付的有效证据，请明确设备、时段或补充所需数据后重试。"
			}`;
		},
	};
}
