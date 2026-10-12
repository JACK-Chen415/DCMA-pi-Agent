import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodeHistory } from "../code-events.ts";

const row = (index: number, fault: string | number | null, alarm: string | number | null = 0) => ({ id: String(index), timestamp: String(1791594000000 + index * 1000), fault_code: fault, alarm_code: alarm });
const iso = (index: number) => new Date(Number(row(index, 0).timestamp)).toISOString();

test("全历史事件合并连续代码，归零与换码关闭，故障报警独立且缺失不冒充恢复", () => {
	const history = createCodeHistory({ table: "real_data_01", page: 1 });
	const records = [row(0, "F1"), row(1, "F1", "A1"), row(2, null, "A1"), row(3, "F1", "A2"), row(4, 0, 0), row(5, "F1"), row(6, "F1"), { ...row(7, 0), timestamp: "invalid" }, row(8, "F1")];
	const before = structuredClone(records);
	for (const record of records) history.add(record);
	const result = history.finish();
	assert.deepEqual([result.total, result.faults, result.alarms, result.open, result.invalidTimes], [4, 2, 2, 1, 1]);
	const first = result.events.find((event) => event.id === "fault_code/0")!;
	assert.deepEqual([first.startedAt, first.endedAt, first.lastSeenAt, first.samples, first.ending, first.startUncertain, first.hasMissingSamples], [iso(0), iso(4), iso(3), 3, "zero", true, true]);
	const open = result.events[0];
	assert.deepEqual([open.startedAt, open.endedAt, open.samples, open.startUncertain, open.hasMissingSamples], [iso(5), null, 3, false, true]);
	assert.equal(result.events.find((event) => event.id === "alarm_code/1")!.endedAt, iso(3));
	assert.equal(result.events.find((event) => event.id === "alarm_code/1")!.ending, "changed");
	assert.equal(result.codes.find((code) => code.code === "F1")!.count, 2);
	assert.deepEqual(records, before);
});

test("时间筛选按事件重叠匹配，跨边界保留完整起止时间，未结束事件可查询", () => {
	const records = [row(0, 0), row(1, "F1"), row(2, "F1"), row(3, 0), row(4, "F2")];
	for (const [from, to, ids] of [[iso(2), iso(2), ["fault_code/1"]], [iso(3), iso(4), ["fault_code/4", "fault_code/1"]], [iso(20), iso(30), ["fault_code/4"]], [iso(0), iso(0), []]] as const) {
		const history = createCodeHistory({ table: "real_data_01", page: 1, from, to });
		records.forEach((record) => history.add(record));
		const result = history.finish();
		assert.deepEqual(result.events.map((event) => event.id), ids);
		if (result.events.some((event) => event.code === "F1")) assert.equal(result.events.find((event) => event.code === "F1")!.startedAt, iso(1));
	}
});

test("历史事件覆盖超过200条采样并稳定分页，不受最近窗口限制", () => {
	const records = Array.from({ length: 240 }, (_, index) => row(index, index % 4 === 0 ? "F1" : 0));
	const read = (page: number) => { const history = createCodeHistory({ table: "real_data_01", page }); records.forEach((record) => history.add(record)); return history.finish(); };
	const first = read(1), second = read(2);
	assert.equal(first.total, 60);
	assert.equal(first.events.length, 50);
	assert.equal(second.events.length, 10);
	assert.equal(second.events.at(-1)?.startedAt, iso(0));
	assert.ok(second.events.every((event) => !first.events.some((other) => event.id === other.id)));
	assert.deepEqual(read(1).events, first.events);
	assert.equal(first.codes[0].durationMs, 60000);
	assert.deepEqual(first.codes, second.codes);
	const empty = createCodeHistory({ table: "real_data", page: 1 }).finish();
	assert.deepEqual([empty.total, empty.faults, empty.alarms, empty.open, empty.events.length], [0, 0, 0, 0, 0]);
});

test("代码时长累计完整匹配事件，区分故障报警且未结束只统计最后观察时刻", () => {
	const records = [row(0, "X", "X"), row(1, "X", null), row(2, 0, "X"), row(3, "X", 0), row(4, null, 0), { ...row(4, 0), timestamp: "invalid" }, row(5, "X", 0)];
	const read = (from?: string, to?: string) => {
		const history = createCodeHistory({ table: "real_data_01", page: 1, from, to });
		records.forEach(history.add);
		return history.finish();
	};
	const result = read();
	assert.equal(result.codes.find((code) => code.field === "fault_code")!.durationMs, 4000);
	assert.equal(result.codes.find((code) => code.field === "fault_code")!.count, 2);
	assert.equal(result.codes.find((code) => code.field === "alarm_code")!.durationMs, 3000);
	assert.equal(result.open, 1);
	assert.equal(result.invalidTimes, 1);
	const filtered = read(iso(1), iso(1));
	assert.equal(filtered.codes.find((code) => code.field === "fault_code")!.durationMs, 2000);
	assert.equal(filtered.codes.find((code) => code.field === "alarm_code")!.durationMs, 3000);
	const single = createCodeHistory({ table: "real_data_01", page: 1 });
	single.add(row(0, "F1"));
	assert.equal(single.finish().codes[0].durationMs, 0);
});
