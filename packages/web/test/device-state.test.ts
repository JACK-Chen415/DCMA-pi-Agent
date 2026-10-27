import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeRecord } from "../../../dashboard/database/dashboard-data.ts";
import type { DashboardSource } from "../../../dashboard/database/dashboard-types.ts";
import { databaseDevice } from "../src/dashboard-data.ts";
import type { StateRuleSet } from "../tools/contracts.ts";
import { assessDeviceSource, enrichDeviceStates } from "../tools/device-state.ts";
import { createKnowledgeService } from "../tools/knowledge.ts";

const now = Date.parse("2026-10-27T03:00:00.000Z");
function source(raw: Record<string, unknown> = {}): DashboardSource {
	return {
		table: "real_data_01",
		kind: "simulation",
		deviceIndex: 1,
		available: true,
		message: "",
		latestTimestampAmbiguous: false,
		latest: normalizeRecord({
			id: 1,
			timestamp: String(now - 1000),
			device_name: "G120电机1",
			inverter_name: "G120",
			fault_code: 0,
			alarm_code: "0",
			status: 0,
			...raw,
		}),
	};
}
const rules: StateRuleSet = {
	source: "测试夹具协议，不用于实际设备",
	version: "test-1",
	rules: [
		{ state: "running", all: [{ field: "status", operator: "eq", value: 1 }] },
		{ state: "stopped", all: [{ field: "status", operator: "eq", value: 2 }] },
	],
};

test("live code observations never turn zero or missing values into a running or healthy claim", () => {
	const zero = assessDeviceSource(source(), now);
	assert.equal(zero.label, "未报告故障/报警");
	assert.equal(zero.state, "unknown");
	assert.equal(zero.tone, "info");
	assert.equal(assessDeviceSource(source({ fault_code: "F01030", alarm_code: "A1" }), now).label, "故障码非零");
	assert.equal(assessDeviceSource(source({ alarm_code: "A1" }), now).label, "报警码非零");
	for (const value of [null, "", " "]) {
		const missing = assessDeviceSource(source({ fault_code: value }), now);
		assert.equal(missing.state, "unknown");
		assert.match(missing.detail, /缺失/);
	}
});

test("history, stale, future, duplicate, missing and invalid samples cannot yield a current state", () => {
	const cases: [DashboardSource, RegExp][] = [
		[{ ...source(), table: "real_data", kind: "acquired" }, /历史/],
		[source({ timestamp: String(now - 60001) }), /过期/],
		[source({ timestamp: String(now + 1) }), /晚于/],
		[source({ timestamp: "invalid" }), /无法解析/],
		[{ ...source(), latestTimestampAmbiguous: true }, /重复/],
		[{ ...source(), latestTimestampAmbiguous: undefined }, /唯一性/],
		[{ ...source(), latest: null }, /暂无/],
		[{ ...source(), available: false }, /不可读取/],
		[{ ...source(), message: "同一来源包含多个设备" }, /多个设备/],
	];
	for (const [input, reason] of cases) {
		const state = assessDeviceSource(input, now, rules);
		assert.equal(state.state, "unknown");
		assert.equal(state.tone, "neutral");
		assert.match(`${state.label} ${state.detail}`, reason);
	}
	assert.equal(assessDeviceSource(source({ timestamp: String(now - 60000) }), now).label, "未报告故障/报警");
});

test("only unique documented rules establish running or stopped; conflicting or incomplete rules stay unknown", () => {
	assert.equal(assessDeviceSource(source({ status: "1" }), now, rules).state, "running");
	assert.equal(assessDeviceSource(source({ status: 2 }), now, rules).state, "stopped");
	for (const input of [source({ status: null }), source({ status: 5 })]) {
		assert.equal(assessDeviceSource(input, now, rules).state, "unknown");
	}
	const conflict: StateRuleSet = {
		...rules,
		rules: [...rules.rules, { state: "fault", all: [{ field: "status", operator: "gt", value: 0 }] }],
	};
	assert.equal(assessDeviceSource(source({ status: 1 }), now, conflict).state, "unknown");
	assert.equal(assessDeviceSource(source({ status: 1, fault_code: "F1" }), now, rules).label, "故障码非零");
});

test("profile changes take effect on refresh and invalid config never erases database readings", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-state-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const knowledge = createKnowledgeService(directory);
	const sources = [source({ status: 1 }), { ...source(), table: "real_data" as const, kind: "acquired" as const }];
	assert.equal((await enrichDeviceStates(sources, knowledge, now))[0].assessment?.state, "unknown");
	await writeFile(
		join(directory, "profiles.json"),
		JSON.stringify({
			profiles: [
				{
					table: "real_data_01",
					manufacturer: null,
					model: null,
					version: null,
					source: "test",
					units: {},
					stateRules: rules,
				},
			],
		}),
	);
	const next = await enrichDeviceStates(sources, knowledge, now);
	assert.equal(next[0].assessment?.state, "running");
	assert.equal(next[1].assessment?.state, "unknown");
	assert.deepEqual(next[0].latest, sources[0].latest);
	await writeFile(join(directory, "profiles.json"), "invalid");
	const invalid = await enrichDeviceStates(sources, knowledge, now);
	assert.match(invalid[0].assessment?.detail ?? "", /配置/);
	assert.deepEqual(invalid[0].latest, sources[0].latest);
});

test("device mapping distinguishes same-name sources and invalidates a cached current status", () => {
	const source: DashboardSource = {
		table: "real_data_01",
		kind: "simulation",
		deviceIndex: 1,
		available: true,
		message: "",
		latest: normalizeRecord({ id: 1, timestamp: "1793066400000", device_name: "G120电机1" }),
	};
	const device = databaseDevice("real_data_01", source);
	assert.equal(device.sourceLabel, "模拟数据");
	assert.equal(
		databaseDevice("real_data", { ...source, table: "real_data", kind: "acquired" }).sourceLabel,
		"历史采集",
	);
	assert.equal(device.name, "G120电机1");
	const assessed = { ...source, assessment: assessDeviceSource(source, now, rules) };
	const active = {
		...assessed,
		assessment: {
			...assessed.assessment,
			state: "running" as const,
			label: "运行中",
			tone: "success" as const,
			expiresAt: new Date(now + 1000).toISOString(),
		},
	};
	assert.equal(databaseDevice("real_data_01", active, "", now).status, "running");
	assert.equal(databaseDevice("real_data_01", active, "", now + 1001).status, "unknown");
	assert.equal(databaseDevice("real_data_01", active, "查询失败", now).status, "unknown");
});
