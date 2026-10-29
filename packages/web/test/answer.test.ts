import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceRecord } from "../interaction-contracts.ts";
import { searchFaultKnowledge } from "../knowledge-index.ts";
import {
	analyzeThresholdEvents,
	assessDeviceState,
	checkDataQuality,
	codeEventsFromWindow,
	compareMetricWindows,
	summarizeMetrics,
} from "../tools/analytics.ts";
import { createAnswerDelivery, renderAnalysis } from "../tools/answer.ts";
import { createEvidenceStore } from "../tools/runtime-files.ts";
import { chartFixture } from "./chart-fixture.ts";

function fixture() {
	const store = createEvidenceStore();
	const { window } = chartFixture([38, 38, 38, 38, 38]);
	window.records.splice(2, 1);
	const summary = summarizeMetrics(window, ["motor_temp"], 20);
	const record = store.add(
		"summarize_metrics",
		{},
		{ ...summary, records: 151201, metrics: summary.metrics.map((item) => ({ ...item, unit: "℃" })) },
	);
	const plan = { format: "brief", claims: [{ kind: "metric_summary", evidenceId: record.id }] };
	return { store, window, record, plan };
}

test("renderer preserves exact counts and configured units without inventing rankings or continuity", () => {
	const { record, plan } = fixture();
	const output = renderAnalysis(plan, [record]);
	assert.match(output, /151201条/);
	assert.match(output, /平均38，范围38～38/);
	assert.match(output, /℃/);
	assert.doesNotMatch(output, /最平稳|偏小|已确认|用户配置|数据覆盖完整|完整采样/);
	const report = renderAnalysis({ ...plan, format: "report" }, [record]);
	assert.match(report, /^# 设备运行分析报告/);
	assert.match(report, /\| 指标 \| 均值/);
});

test("unsupported claims, arbitrary prose, foreign evidence and wrong evidence types fail closed", () => {
	const { record, plan } = fixture();
	for (const [kind, message] of [
		["stability_ranking", /统一比较方法/],
		["relative_level", /不能证明偏高或偏低/],
		["event_alignment", /报警区间对齐/],
	] as const)
		assert.throws(
			() => renderAnalysis({ format: "brief", claims: [{ kind, evidenceId: record.id }] }, [record]),
			message,
		);
	assert.throws(() => renderAnalysis({ ...plan, text: "温度最平稳" }, [record]), /结构无效/);
	assert.throws(
		() => renderAnalysis({ format: "brief", claims: [{ ...plan.claims[0], value: 999 }] }, [record]),
		/结构无效/,
	);
	assert.throws(() => renderAnalysis(plan, []), /不属于本轮/);
	assert.throws(
		() => renderAnalysis({ format: "brief", claims: [{ kind: "continuity", evidenceId: record.id }] }, [record]),
		/不能支持/,
	);
	const other: EvidenceRecord = {
		...record,
		id: "22222222-2222-4222-8222-222222222222",
		result: { ...(record.result as object), from: "2026-10-20T16:00:00Z" },
	};
	assert.throws(
		() =>
			renderAnalysis(
				{ format: "brief", claims: [...plan.claims, { kind: "metric_summary", evidenceId: other.id }] },
				[record, other],
			),
		/混用了设备或时间窗口/,
	);
});

test("continuity conclusions require an actual quality check and retain its gap criterion", () => {
	const { store, window, record } = fixture();
	const quality = store.add("check_data_quality", {}, checkDataQuality(window, ["motor_temp"], 15));
	const output = renderAnalysis({ format: "brief", claims: [{ kind: "continuity", evidenceId: quality.id }] }, [
		record,
		quality,
	]);
	assert.match(output, /最大采样间隔15秒/);
	assert.match(output, /发现1处内部间断/);
	assert.doesNotMatch(output, /完整采样|无断点/);
});

test("event patterns stay attached to the returned events and do not become whole-window or causal claims", () => {
	const { store } = fixture();
	const { window } = chartFixture([1, 1, 1, 1, 1]);
	window.availableFields.push("fault_code", "alarm_code");
	for (const [index, row] of window.records.entries()) {
		row.raw.fault_code = "0";
		row.raw.alarm_code = index === 2 || index === 4 ? "0" : "A07089";
	}
	const events = store.add("get_code_events", {}, codeEventsFromWindow(window));
	const output = renderAnalysis(
		{ format: "brief", claims: [{ kind: "event_pattern", evidenceId: events.id, code: "A07089" }] },
		[events],
	);
	assert.match(output, /本次已查看的2条A07089/);
	assert.match(output, /间隔为0.5～0.5分钟/);
	assert.match(output, /不推广到未查看事件/);
	assert.doesNotMatch(output, /更像持续/);
});

test("manual meanings use original code and plain source text without internal scores or JSON links", async () => {
	const { store } = fixture();
	const record = store.add("search_fault_knowledge", {}, await searchFaultKnowledge({ code: "A07089" }));
	const output = renderAnalysis({ format: "brief", claims: [{ kind: "manual", evidenceId: record.id }] }, [record]);
	assert.match(output, /S120.*手册/);
	assert.match(output, /232/);
	assert.match(output, /A07089 单位转换/);
	assert.doesNotMatch(output, /F07090|\/api\/knowledge|KB-001|词法|语义|综合分数/);
});

test("event and manual claims share each cited meaning and applicability reminder once", async () => {
	const { store } = fixture();
	const { window } = chartFixture([1, 1, 1]);
	window.availableFields.push("fault_code", "alarm_code");
	for (const row of window.records) {
		row.raw.fault_code = "0";
		row.raw.alarm_code = "A07089";
	}
	const events = store.add("get_code_events", {}, codeEventsFromWindow(window));
	const result = await searchFaultKnowledge({ code: "A07089" });
	const manual = store.add("search_fault_knowledge", {}, result);
	const repeated = store.add("search_fault_knowledge", {}, result);
	const eventClaim = { kind: "events", evidenceId: events.id };
	const manualClaim = { kind: "manual", evidenceId: manual.id };
	for (const format of ["brief", "report"]) {
		for (const claims of [
			[eventClaim, manualClaim],
			[manualClaim, eventClaim],
		]) {
			const output = renderAnalysis({ format, claims: [...claims, { kind: "manual", evidenceId: repeated.id }] }, [
				events,
				manual,
				repeated,
			]);
			assert.equal(output.match(/A07089 单位转换/g)?.length, 1);
			assert.equal(output.match(/现场型号/g)?.length, 1);
			assert.match(output, /报警事件1次/);
			assert.match(output, /232/);
			assert.match(output, /确认适用后按现场规程执行/);
			assert.doesNotMatch(output, /含义未确认|## 手册依据\n\n(?:##|限制说明|$)/);
		}
	}
	const otherSource = store.add(
		"search_fault_knowledge",
		{},
		{
			...result,
			results: result.results.map((item) => ({ ...item, source_file: "另一份手册.pdf" })),
		},
	);
	const distinct = renderAnalysis(
		{ format: "brief", claims: [manualClaim, { kind: "manual", evidenceId: otherSource.id }] },
		[manual, otherSource],
	);
	assert.match(distinct, /S120.*手册/);
	assert.match(distinct, /另一份手册/);
});

test("the delivery gate never releases a skipped, failed or forged analysis draft", () => {
	const { record, plan } = fixture();
	const gate = createAnswerDelivery();
	assert.equal(gate.finish("请补充要查询的时段。"), "请补充要查询的时段。");
	gate.start("summarize_metrics");
	gate.record(record);
	assert.doesNotMatch(gate.finish("电流偏小，温度最平稳。"), /电流偏小|温度最平稳/);
	assert.throws(
		() => gate.record({ ...record, tool: "submit_analysis", result: { validated: true, text: "温度最平稳" } }),
		/未经本轮校验/,
	);
	assert.throws(() =>
		gate.submit({ format: "brief", claims: [{ kind: "stability_ranking", evidenceId: record.id }] }),
	);
	const accepted = gate.submit(plan);
	gate.record({ ...record, tool: "submit_analysis", result: accepted });
	assert.equal(gate.finish("自由文字不能覆盖已验证回答"), accepted.text);
	const failed = createAnswerDelivery();
	failed.start("get_code_events");
	assert.doesNotMatch(failed.finish("故障0次，一切正常"), /故障0次|一切正常/);
	assert.throws(() => failed.submit({}));
	assert.throws(() => failed.submit({}));
	assert.equal(failed.exhausted, true);
	assert.throws(() => failed.submit(plan), /修正机会/);
});

test("computed thresholds, condition counts, trends, state rules and unit-consistent comparisons remain usable", () => {
	const store = createEvidenceStore();
	const { window } = chartFixture([0, 0, 51, 52, 0]);
	const summary = summarizeMetrics(window, ["motor_temp"], 20, {
		metric: "motor_temp",
		operator: "gt",
		threshold: 50,
	});
	const summaryRecord = store.add(
		"summarize_metrics",
		{},
		{ ...summary, metrics: summary.metrics.map((metric) => ({ ...metric, unit: "℃" })) },
	);
	const profile = store.add(
		"get_device_profile",
		{},
		{ table: window.table, measurements: [{ field: "motor_temp", unit: "℃" }] },
	);
	const threshold = store.add(
		"analyze_threshold_events",
		{},
		analyzeThresholdEvents(window, {
			metric: "motor_temp",
			operator: "gt",
			threshold: 50,
			minDurationSeconds: 10,
			maxGapSeconds: 15,
			unit: "℃",
			source: "fixture",
		}),
	);
	const output = renderAnalysis(
		{
			format: "brief",
			claims: [
				{ kind: "condition_count", evidenceId: summaryRecord.id },
				{ kind: "trend", evidenceId: summaryRecord.id },
				{ kind: "threshold", evidenceId: threshold.id },
			],
		},
		[summaryRecord, profile, threshold],
	);
	assert.match(output, /大于50的采样点为2个/);
	assert.match(output, /每0.333333分钟汇总均值/);
	assert.match(output, /确认1次满足条件的事件/);
	const badProfile = {
		...profile,
		result: { table: window.table, measurements: [{ field: "motor_temp", unit: "A" }] },
	};
	assert.throws(
		() =>
			renderAnalysis({ format: "brief", claims: [{ kind: "threshold", evidenceId: threshold.id }] }, [
				threshold,
				badProfile,
			]),
		/单位与设备资料不一致/,
	);
	const other = chartFixture([2, 2, 2]).window;
	const comparison = compareMetricWindows(chartFixture([0, 0, 0]).window, other, ["motor_temp"]);
	const compared = store.add("compare_metric_windows", {}, comparison);
	assert.match(
		renderAnalysis({ format: "brief", claims: [{ kind: "comparison", evidenceId: compared.id }] }, [compared]),
		/均值由0变为2，B减A为2/,
	);
	for (const row of window.records) row.raw.speed_actual = 100;
	window.availableFields.push("speed_actual");
	const state = store.add(
		"assess_device_state",
		{},
		assessDeviceState(window, 60, Date.parse(window.to), {
			source: "fixture",
			version: "1",
			rules: [{ state: "running", all: [{ field: "speed_actual", operator: "gt", value: 50 }] }],
		}),
	);
	assert.match(
		renderAnalysis({ format: "brief", claims: [{ kind: "state", evidenceId: state.id }] }, [state]),
		/状态评估：运行/,
	);
});

test("archiving failure cannot commit an answer, and escaped source text cannot create a link", () => {
	const { record, plan } = fixture();
	const gate = createAnswerDelivery();
	gate.start("summarize_metrics");
	gate.record(record);
	gate.submit(plan); // Prepared but never committed by the successful archive path.
	assert.match(gate.finish("unsafe draft"), /未通过交付校验/);
	const reading = {
		...record,
		tool: "read_industrial_rows",
		result: { rows: [{ motor_temp: "[点此](https://untrusted.invalid)", fault_code: "0" }] },
	};
	const output = renderAnalysis({ format: "brief", claims: [{ kind: "reading", evidenceId: reading.id }] }, [reading]);
	assert.match(output, /\\\[点此\\\]/);
	assert.doesNotMatch(output, /数据覆盖完整/);
});

test("recent readings keep their configured units and available downloads remain in validated output", () => {
	const { store, window } = fixture();
	const reading = store.add(
		"read_industrial_dashboard",
		{},
		{
			table: window.table,
			latest: { acquiredAt: window.to, values: { motor_temp: 38 } },
			units: { motor_temp: "℃" },
		},
	);
	const attachment = store.add(
		"export_analysis_report",
		{},
		{
			markdownUrl: "/api/tools/reports/11111111-1111-4111-8111-111111111111.md",
			jsonUrl: "/api/tools/reports/11111111-1111-4111-8111-111111111111.json",
		},
	);
	const proposal = store.add(
		"manage_monitoring_task",
		{},
		{ status: "pending_confirmation", approvalPath: "/api/monitoring/confirm/11111111-1111-4111-8111-111111111111" },
	);
	const output = renderAnalysis(
		{ format: "brief", claims: [{ kind: "reading", evidenceId: reading.id, metric: "motor_temp" }] },
		[reading, attachment, proposal],
	);
	assert.match(output, /电机温度38℃/);
	assert.doesNotMatch(output, /单位未取得|单位已配置|用户配置/);
	assert.match(output, /Markdown数据附件/);
	assert.match(output, /后台监测操作尚未启用/);
});
