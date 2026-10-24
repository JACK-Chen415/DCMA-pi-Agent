import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createKnowledgeService } from "../tools/knowledge.ts";

const definition = {
	id: "fixture",
	manufacturer: "Synthetic",
	model: "M1",
	version: "1",
	kind: "manual",
	text: "F_TEST 合成故障\n驱动对象：测试对象\n原因：合成原因\n处理：合成处理及注意事项",
	source: { title: "synthetic", locator: "fixture pages 1-2", revision: "1" },
	codes: [{ kind: "fault", code: "F_TEST", meaning: "合成故障", steps: ["合成处理及注意事项"] }],
};
const input = { manufacturer: "Synthetic", model: "M1", version: "1", code: "F_TEST", kind: "fault" as const };

test("simulation setup configures units for four sources without inventing real identities or overwriting profiles", async () => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-simulation-"));
	try {
		const output = join(directory, "profiles.json");
		const script = fileURLToPath(new URL("../../../scripts/configure-simulation-profiles.ts", import.meta.url));
		execFileSync(process.execPath, [script, output], { stdio: "pipe" });
		const service = createKnowledgeService(directory);
		for (const table of ["real_data_01", "real_data_02", "real_data_03", "real_data_04"] as const) {
			const profile = await service.getDeviceProfile(table);
			assert.equal(profile.configured, true);
			assert.equal(profile.kind, "simulation");
			assert.equal(profile.model, null);
			assert.equal(profile.manufacturer, null);
			assert.equal(profile.ratedValues, null);
			assert.equal(profile.stateRules, null);
			assert.equal(profile.measurements.length, 18);
			assert.ok(profile.measurements.every((item) => item.unitStatus === "user_configured"));
			assert.equal(profile.measurements.find((item) => item.field === "current_actual")?.unit, "A");
			assert.equal(profile.measurements.find((item) => item.field === "motor_temp")?.unit, "°C");
			assert.equal(profile.measurements.find((item) => item.field === "pulse_frequency")?.unit, "kHz");
			assert.equal(profile.codeConventions.fault_code.zero, "未报告故障");
			assert.equal(profile.codeConventions.alarm_code.zero, "未报告报警");
			assert.match(profile.codeConventions.otherCodes, /不能套用/);
		}
		assert.equal((await service.getDeviceProfile("real_data")).configured, false);
		const before = await readFile(output, "utf8");
		assert.throws(() => execFileSync(process.execPath, [script, output], { stdio: "pipe" }));
		assert.equal(await readFile(output, "utf8"), before);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("imported manuals exceeding 500 entries and 1 MiB remain searchable with complete code context", async () => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-knowledge-"));
	try {
		const entries = Array.from({ length: 600 }, (_, index) => ({
			...definition,
			id: `fixture-${index}`,
			text: index === 599 ? definition.text : "合成测试资料。".repeat(200),
			codes: index === 599 ? definition.codes : [],
		}));
		const json = JSON.stringify({ entries });
		assert.ok(Buffer.byteLength(json) > 1024 * 1024);
		await writeFile(join(directory, "knowledge.json"), json);
		const service = createKnowledgeService(directory);
		const result = await service.lookupFaultCode(input);
		assert.equal(result.configured, true);
		assert.equal(result.total, 1);
		assert.equal(result.matches[0].text, definition.text);
		assert.equal(result.matches[0].source.locator, "fixture pages 1-2");
		assert.equal((await service.lookupFaultCode({ ...input, version: "2" })).found, false);
		assert.equal((await service.lookupFaultCode({ ...input, kind: "alarm" })).found, false);
		assert.equal((await service.searchMaintenanceKnowledge({ query: "F_TEST" })).matches[0].id, "fixture-599");
		assert.equal((await service.getDeviceProfile("real_data_01")).configured, false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("knowledge limits remain bounded and do not increase the profile configuration limit", async () => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-knowledge-"));
	try {
		const service = createKnowledgeService(directory);
		assert.equal((await service.searchMaintenanceKnowledge({ query: "absent" })).configured, false);
		await writeFile(join(directory, "knowledge.json"), " ".repeat(8 * 1024 * 1024 + 1));
		await assert.rejects(service.lookupFaultCode(input), /配置或查询无效/);
		await writeFile(
			join(directory, "knowledge.json"),
			JSON.stringify({
				entries: Array.from({ length: 2001 }, (_, index) => ({ ...definition, id: `id-${index}` })),
			}),
		);
		await assert.rejects(service.searchMaintenanceKnowledge({ query: "F_TEST" }), /配置或查询无效/);
		await writeFile(
			join(directory, "profiles.json"),
			`${JSON.stringify({ profiles: [] })}${" ".repeat(1024 * 1024)}`,
		);
		await assert.rejects(service.getDeviceProfile("real_data_01"), /配置或查询无效/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("multiple definitions retain drive-object sources within the existing response budget", async () => {
	const directory = await mkdtemp(join(tmpdir(), "dcma-knowledge-"));
	try {
		await writeFile(
			join(directory, "knowledge.json"),
			JSON.stringify({
				entries: Array.from({ length: 12 }, (_, index) => ({
					...definition,
					id: `variant-${index}`,
					text: "合成原文".repeat(3000),
					source: { ...definition.source, locator: `fixture variant ${index}` },
				})),
			}),
		);
		const result = await createKnowledgeService(directory).lookupFaultCode(input);
		assert.equal(result.total, 12);
		assert.equal(result.hasMore, true);
		assert.ok(result.matches.length > 0 && result.matches.length < 10);
		assert.ok(Buffer.byteLength(JSON.stringify(result.matches)) < 48000);
		assert.equal(result.matches[0].text.length, 12000);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
