import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	fauxAssistantMessage,
	getCurrentSystemPrompt,
	getCurrentTools,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { createHarness } from "../../coding-agent/test/suite/harness.ts";
import { industrialSystemPrompt } from "../tools/prompt.ts";
import { createIndustrialResourceLoader } from "../tools/resources.ts";

test("web resources retain five skill entries and preload each shared workflow once", () => {
	const loader = createIndustrialResourceLoader();
	const { skills, diagnostics } = loader.getSkills();
	assert.deepEqual(diagnostics, []);
	assert.deepEqual(
		skills.map((skill) => skill.name),
		[
			"analysis-visualization-report",
			"device-operation-analysis",
			"fault-investigation",
			"rca-evidence-chain",
			"work-order-draft",
		],
	);
	const prompt = loader.getAppendSystemPrompt().join("\n\n").replace(/\r\n/g, "\n");
	for (const skill of skills) {
		const content = readFileSync(skill.filePath, "utf8").trim();
		const { frontmatter, body } = parseFrontmatter<{ metadata: { version: string } }>(content);
		assert.match(frontmatter.metadata.version, /^\d+\.\d+\.\d+$/);
		assert.ok(body.length > 0);
		assert.ok(prompt.includes(`<industrial_skill name="${skill.name}">`));
		assert.ok(prompt.includes(skill.description));
		assert.equal(prompt.split(body.replace(/\r\n/g, "\n").trim()).length - 1, 1);
		assert.equal(skill.disableModelInvocation, false);
	}
	assert.equal(loader.getAgentsFiles().agentsFiles.length, 0);
	assert.equal(loader.getExtensions().extensions.length, 0);
	const faultSkill = skills.find((skill) => skill.name === "fault-investigation");
	assert.ok(faultSkill);
	const faultInstructions = readFileSync(faultSkill.filePath, "utf8");
	assert.match(faultInstructions, /正式异常链路交付/);
	assert.match(faultInstructions, /直接原因（设备\/部件机制）—条件因素/);
	assert.match(faultInstructions, /【证据缺口：缺/);
	assert.match(faultInstructions, /【假设·待验证】/);
	assert.match(faultInstructions, /【动作不完整/);
	assert.match(faultInstructions, /【不可关闭】/);
	assert.match(faultInstructions, /【验证不充分】/);
	const rcaSkill = skills.find((skill) => skill.name === "rca-evidence-chain");
	assert.ok(rcaSkill);
	const rcaInstructions = readFileSync(rcaSkill.filePath, "utf8");
	assert.match(rcaInstructions, /^name: rca-evidence-chain/m);
	assert.match(rcaInstructions, /正式异常链路交付/);
	assert.match(rcaInstructions, /【证据缺口：缺/);
	const normalizeSkillText = (value: string) => value.replace(/\r\n/g, "\n").replace(/\n+$/u, "");
	assert.equal(
		normalizeSkillText(
			rcaInstructions
				.replace(/^name: rca-evidence-chain/m, "name: fault-investigation")
				.replace(/^description: .*$/m, "description: CLONED"),
		),
		normalizeSkillText(faultInstructions.replace(/^description: .*$/m, "description: CLONED")),
		"RCA Skill must be a clone; the original fault-investigation Skill remains intact",
	);
	assert.ok(prompt.includes("与已加载的 fault-investigation 共用同一工作流及完成标准。"));
});

test("SDK sends skill bodies on real prompt turns without granting file or terminal tools", async () => {
	const loader = createIndustrialResourceLoader();
	const harness = await createHarness({
		resourceLoader: loader,
		tools: [],
		initialActiveToolNames: [],
		allowedToolNames: [],
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		const requests = [
			"介绍一下电机1的基本信息。",
			"请帮我生成该设备近一周的报告。",
			"最近一小时电机温度超过50℃有多少个采样点？",
			"故障码F30001是什么含义，应该检查什么？",
			"用rca-evidence-chain整理这次异常的证据链。",
			"将刚才的分析画成趋势图并导出报告。",
			"把这次异常整理成待审核工单草稿。",
		];
		let observed = 0;
		harness.setResponses(
			requests.map(() => (context: TranscriptContext) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				assert.ok(prompt.includes(industrialSystemPrompt));
				for (const skill of loader.getSkills().skills) {
					const { body } = parseFrontmatter(readFileSync(skill.filePath, "utf8"));
					assert.ok(prompt.includes(`<industrial_skill name="${skill.name}">`));
					assert.ok(prompt.includes(skill.description));
					assert.equal(prompt.replace(/\r\n/g, "\n").split(body.replace(/\r\n/g, "\n").trim()).length - 1, 1);
				}
				assert.deepEqual(getCurrentTools(context.messages), []);
				observed++;
				return fauxAssistantMessage("离线测试响应，仅用于验证 Skill 上下文传递。");
			}),
		);
		for (const request of requests) await harness.session.prompt(request);
		assert.equal(observed, requests.length);
		assert.deepEqual(harness.session.getActiveToolNames(), []);
	} finally {
		harness.cleanup();
	}
});
