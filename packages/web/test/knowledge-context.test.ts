import assert from "node:assert/strict";
import test from "node:test";
import { faultKnowledgeContext } from "../knowledge-context.ts";
import {
	type FaultKnowledgeRecord,
	getFaultKnowledgeIndex,
	listFaultKnowledgeSources,
	searchFaultKnowledge,
} from "../knowledge-index.ts";

function page(number: number, text: string): FaultKnowledgeRecord {
	return {
		id: `page-${number}`,
		source_id: "fixture",
		source_file: "fixture.pdf",
		locator: `第 ${number} 页`,
		page: number,
		title: "fixture",
		kind: "drive_fault_manual",
		trust: "fixture",
		codes: ["F30001"],
		text,
		agent_use: "retrieval_evidence",
	};
}

test("fault context joins continuation pages and excludes adjacent remedies without changing indexed records", () => {
	const records = [
		page(1, "F30000 其他故障\n信息值：-\n处理：更换存储卡。\nF30001 过电流\n信息值：-\n原因：电流过大。"),
		page(2, "处理：检查电机连接。\nF30002 过电压\n信息值：-\n处理：检查制动电阻。"),
	];
	const original = JSON.stringify(records);
	const result = faultKnowledgeContext(records, records[0], "F30001");
	assert.ok(result);
	assert.match(result.text, /检查电机连接/);
	assert.doesNotMatch(result.text, /存储卡|F30002|制动电阻/);
	assert.match(result.locator, /1、2/);
	assert.equal("context_complete" in result && result.context_complete, true);
	assert.equal(JSON.stringify(records), original);
	assert.equal(faultKnowledgeContext(records, records[1], "F99999"), null);
});

test("repeated codes retain separate drive objects, and missing pages are never presented as complete", () => {
	const records = [
		page(1, "F07011 电机超温\n信息值：-\n驱动对象：SERVO\n原因：温度过高。"),
		page(2, "处理：检查传感器。\nF07011 电机超温\n信息值：-\n驱动对象：VECTOR\n原因：温度过高。"),
		page(4, "处理：不应跨缺页拼接。\nA07012 预警\n信息值：-"),
	];
	const result = faultKnowledgeContext(records, records[1], "F07011");
	assert.ok(result);
	assert.match(result.text, /SERVO/);
	assert.match(result.text, /VECTOR/);
	assert.doesNotMatch(result.text, /不应跨缺页拼接|A07012/);
	assert.equal("context_complete" in result && result.context_complete, false);
});

test("real F30001 retrieval includes its next-page treatment and its source URL reproduces the same context", async () => {
	const records = await getFaultKnowledgeIndex();
	const original = JSON.stringify(records);
	const result = await searchFaultKnowledge({ code: "F30001" });
	assert.ok(result.results.length > 0);
	const match = result.results[0];
	assert.match(match.text, /检查电机数据/);
	assert.match(match.text, /检查功率电缆连接/);
	assert.doesNotMatch(match.text, /受保护文件|替换存储卡|F30002/);
	assert.match(match.locator, /378、379/);
	const url = new URL(match.source_url, "http://localhost");
	const context = await searchFaultKnowledge({ id: url.searchParams.get("id")!, code: url.searchParams.get("code")! });
	assert.equal(context.results[0].text, match.text);
	assert.equal(JSON.stringify(records), original);
	assert.equal(result.retrieval_log.vector_query_used, false);
});

test("manual appendices are not attached as a fault remedy", () => {
	const records = [
		page(1, "4.2 故障和报警列表\nF30001 过电流\n信息值：-\n处理：核查连接。"),
		page(2, "附录\n此处不是故障处理。"),
	];
	const result = faultKnowledgeContext(records, records[0], "F30001");
	assert.ok(result);
	assert.match(result.text, /核查连接/);
	assert.doesNotMatch(result.text, /附录|此处不是/);
});

test("large cross-page results preserve top-ranked contexts and disclose reduced result counts within the tool budget", async () => {
	const result = await searchFaultKnowledge({ source: "s120-fault-manual", limit: 20 });
	const first = await searchFaultKnowledge({ source: "s120-fault-manual", limit: 1 });
	assert.equal(result.truncated, true);
	assert.match(result.result_notice ?? "", /减少返回条数/);
	assert.ok(result.count > 0 && result.count < 20);
	assert.equal(result.count, result.results.length);
	assert.equal(result.retrieval_log.returned_count, result.count);
	assert.deepEqual(result.results[0], first.results[0]);
	assert.ok(Buffer.byteLength(JSON.stringify(result)) < 62000);
});

test("invalid knowledge filters are correctable errors, while valid filters remain effective", async () => {
	await assert.rejects(searchFaultKnowledge({ code: "A07089", kind: "alarm" }), /kind是资料类型.*drive_fault_manual/);
	await assert.rejects(
		searchFaultKnowledge({ code: "A07089", source: "S120_故障手册.pdf" }),
		/sourceId.*s120-fault-manual/,
	);
	const result = await searchFaultKnowledge({
		code: "A07089",
		source: "s120-fault-manual",
		kind: "drive_fault_manual",
	});
	assert.equal(result.count, 1);
	assert.equal(result.retrieval_log.vector_query_used, false);
	const motor = (await listFaultKnowledgeSources()).sources.find((item) => item.kind === "motor_manual")!;
	assert.equal((await searchFaultKnowledge({ code: "A07089", source: motor.sourceId })).count, 0);
	assert.equal((await searchFaultKnowledge({ code: "A07089", kind: "motor_manual" })).count, 0);
});

test("page furniture glued to a definition ends the previous entry without treating ordinary references as headings", () => {
	const records = [
		page(1, "A07089 单位转换\n信息值：-\n原因：测试。\nF07090 正文引用\n此处不是信息值字段。\n处理：恢复单位。"),
		page(
			2,
			"4 故障和报警\n4.2 故障和报警列表\nSINAMICS S120/S150\n2720 参数手册 , 06/2020, 6SL3097 -5AP00-0RP2F07090 转矩上限\n信息值：-\n处理：检查转矩。",
		),
	];
	const result = faultKnowledgeContext(records, records[0], "A07089");
	assert.ok(result);
	assert.match(result.text, /恢复单位|F07090 正文引用/);
	assert.doesNotMatch(result.text, /转矩上限|检查转矩|参数手册|SINAMICS/);
	assert.equal(result.locator, "第 1 页");
	assert.equal("context_complete" in result && result.context_complete, true);
});

test("real A07089 context contains only its definition and preserves indexed evidence", async () => {
	const records = await getFaultKnowledgeIndex();
	const before = JSON.stringify(records);
	const result = await searchFaultKnowledge({ code: "A07089" });
	assert.equal(result.count, 1);
	assert.match(result.results[0].text, /转换单位后不能激活功能块/);
	assert.match(result.results[0].text, /将单位恢复到出厂设置/);
	assert.doesNotMatch(result.results[0].text, /F07090|转矩上限小于下限/);
	assert.equal(result.results[0].locator, "第 232 页");
	assert.equal("context_complete" in result.results[0] && result.results[0].context_complete, true);
	assert.equal(JSON.stringify(records), before);
});
