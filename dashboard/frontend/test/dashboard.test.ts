import assert from "node:assert/strict";
import { test } from "node:test";
import { displayTime, displayValue, displayRaw, displayRawField, codeClassName, displayFieldLabel, fieldUnits, sampleIdentity, displaySampleAge, sampleRange, linePath } from "../src/dashboard-view.ts";
import { dashboardExample } from "../../database/test/dashboard-example.ts";
import { displaySamplingSpan, eventSamplingRange, recentCodeHistory } from "../src/code-analysis.ts";
import type { CodeEvent } from "../src/database-types.ts";

test("样本年龄采用成功查询时刻，不混同刷新成功、采集更新或设备故障", () => {
	const start = "2026-10-14T07:00:00.000Z";
	for (const [milliseconds, expected] of [[0, "不足1秒"], [999, "不足1秒"], [4000, "4秒"], [61000, "1分 1秒"], [3660000, "1小时 1分"], [90000000, "1天 1小时"]] as const) {
		assert.equal(displaySampleAge(start, new Date(Date.parse(start) + milliseconds).toISOString()), expected);
	}
	assert.equal(displaySampleAge(start, "2026-10-14T06:59:59.000Z"), "采集时间晚于查询时间");
	assert.equal(displaySampleAge(null, start), "—");
	assert.equal(displaySampleAge(start, "invalid"), "—");
});

test("事件回看保留已观察区间和前后5分钟，未结束不使用当前时间", () => {
	const event: CodeEvent = { id: "fault/1", field: "fault_code", code: "F01030", startedAt: "2026-01-14T10:20:37.005Z", endedAt: null, lastSeenAt: "2026-01-14T10:27:24.814Z", samples: 2, ending: null, startUncertain: true, hasMissingSamples: true };
	assert.deepEqual(eventSamplingRange(event), { from: "2026-01-14T10:15:37.000Z", to: "2026-01-14T10:32:25.000Z" });
	assert.deepEqual(eventSamplingRange({ ...event, endedAt: "2026-01-14T10:28:00.000Z" }), { from: "2026-01-14T10:15:37.000Z", to: "2026-01-14T10:33:00.000Z" });
	assert.deepEqual(eventSamplingRange({ ...event, lastSeenAt: event.startedAt }), { from: "2026-01-14T10:15:37.000Z", to: "2026-01-14T10:25:38.000Z" });
	assert.equal(eventSamplingRange({ ...event, startedAt: "invalid" }), null);
	assert.equal(eventSamplingRange({ ...event, lastSeenAt: "2026-01-14T10:00:00Z" }), null);
});

test("展板显示保留0、负数、原始代码并明确缺失值和北京时间", () => {
	assert.equal(displayValue(0), "0");
	assert.equal(displayValue(-200), "-200");
	assert.equal(displayValue("0000:00:00"), "0000:00:00");
	assert.equal(displayRaw(0.123456789), "0.123456789");
	assert.equal(displayRaw(0), "0");
	assert.match(displayTime("2026-01-14T10:27:24.814Z", false, true), /18:27:24.814/);
	for (const value of [null, undefined, ""]) assert.equal(displayValue(value), "—");
	assert.match(displayTime("2026-01-14T10:27:24.814Z"), /18:27:24/);
	const example = dashboardExample();
	assert.equal(example.records.length, 100);
	assert.equal(example.samples.length, 100);
	assert.ok(example.samples.every((sample, index) => index === 0 || sample.acquiredAt >= example.samples[index - 1].acquiredAt));
	assert.notEqual(sampleIdentity(example.latest), sampleIdentity(null));
	assert.match(example.latest!.raw.device_name!, /开发样例/);
});

test("参考单位只作标注，故障报警零值仅显示0，其他代码和缺失保留", () => {
	assert.equal(displayFieldLabel("speed_actual"), "实际转速（rpm）");
	assert.equal(displayFieldLabel("torque_actual"), "实际转矩（N·m）");
	assert.equal(displayFieldLabel("inverter_load_rate"), "变频器负荷率（%）");
	assert.equal(fieldUnits.pulse_frequency, "kHz");
	assert.equal(displayFieldLabel("pulse_frequency"), "脉冲频率（kHz）");
	assert.equal(displayRawField("pulse_frequency", 2), "2");
	assert.equal(fieldUnits.system_run_time, undefined);
	for (const field of ["fault_code", "alarm_code"] as const) {
		assert.equal(displayRawField(field, 0), "0");
		assert.equal(displayRawField(field, "0"), "0");
		assert.equal(displayRawField(field, "A2062"), "A2062");
		assert.equal(displayRawField(field, "F01030"), "F01030");
		assert.equal(displayRawField(field, 12), "12");
		for (const value of [null, undefined, ""]) assert.equal(displayRawField(field, value), "—");
	}
	assert.equal(displayRawField("status_word", "0"), "0");
	assert.equal(displayRawField("motor_load_rate", 0.123456789), "0.123456789");
});

test("只有非零故障码与报警码变色，正常、缺失和其他字段保持默认", () => {
	for (const field of ["fault_code", "alarm_code"] as const) {
		for (const value of [0, "0", null, undefined, ""]) assert.equal(codeClassName(field, value), undefined);
		for (const value of [12, "12", "F01030", "A2062"]) {
			assert.equal(codeClassName(field, value), field === "fault_code" ? "fault-code-active" : "alarm-code-active");
		}
	}
	for (const field of ["control_word", "status_word", "speed_actual"] as const) assert.equal(codeClassName(field, 12), undefined);
});

test("仪表采样范围过滤缺失值，恒定值有非零跨度且保留负数", () => {
	assert.equal(sampleRange([null, NaN, Infinity]), null);
	assert.deepEqual(sampleRange([0, null, 20, -10]), { min: -10, max: 20 });
	assert.deepEqual(sampleRange([0, 0]), { min: -1, max: 1 });
	assert.deepEqual(sampleRange([-200, -200]), { min: -220, max: -180 });
});

test("曲线在缺失点断开，0与负值仍保留且单点可绘制", () => {
	assert.equal(linePath([{ x: 0, y: 0 }, { x: 1, y: -2 }, { x: 2, y: null }, { x: 3, y: 4 }]), "M0.00,0.00 L1.00,-2.00  M3.00,4.00");
	assert.equal(linePath([{ x: 0, y: null }, { x: 1, y: 0 }]), "M1.00,0.00");
	assert.equal(linePath([{ x: 0, y: null }]), "");
});

test("异常持续时间保留毫秒并按天、小时、分秒显示", () => {
	assert.equal(displaySamplingSpan(0), "0 秒");
	assert.equal(displaySamplingSpan(1250), "1.25 秒");
	assert.equal(displaySamplingSpan(61250), "1 分 1.25 秒");
	assert.equal(displaySamplingSpan(3660000), "1 小时 1 分");
	assert.equal(displaySamplingSpan(90061001), "1 天 1 小时 1 分 1.001 秒");
});

test("近期事件按采集时间排序并复用连续代码规则，不修改原始采样", () => {
	const original = dashboardExample().records[0];
	const records = [[0, 0], ["F1", 0], ["F1", "A1"], ["F1", "A1"], [0, 0]].map(([fault, alarm], index) => ({
		...original, id: String(index), acquiredAt: new Date(1791594000000 + index * 1000).toISOString(),
		raw: { ...original.raw, fault_code: fault, alarm_code: alarm },
	})).reverse();
	const before = structuredClone(records);
	const history = recentCodeHistory("real_data_01", records);
	assert.equal(history.total, 2);
	assert.equal(history.events.find((event) => event.code === "F1")!.samples, 3);
	assert.equal(history.events.find((event) => event.code === "F1")!.startedAt, records[3].acquiredAt);
	assert.equal(history.events.find((event) => event.code === "F1")!.endedAt, records[0].acquiredAt);
	assert.equal(history.events.find((event) => event.code === "A1")!.samples, 2);
	assert.deepEqual(records, before);
	assert.equal(recentCodeHistory("real_data_01", [{ ...records[0], acquiredAt: null }]).invalidTimes, 1);
	assert.equal(recentCodeHistory("real_data_01", []).total, 0);
});
