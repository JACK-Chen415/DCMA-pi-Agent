import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createExtensionRuntime, loadSkillsFromDir, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { industrialSystemPrompt } from "./prompt.ts";

export function createIndustrialResourceLoader(): ResourceLoader {
	const loaded = loadSkillsFromDir({ dir: fileURLToPath(new URL("../skills/", import.meta.url)), source: "project" });
	if (loaded.skills.length !== 4 || loaded.diagnostics.length) {
		throw new Error("工业 Skill 加载失败，请检查 packages/web/skills 中的四份 SKILL.md。");
	}
	loaded.skills.sort((a, b) => a.name.localeCompare(b.name));
	// The web agent has no file reader; preload these small, repository-owned skills instead of granting file access.
	const instructions = [
		"以下工业 Skill 正文已加载，无需再读文件。先明确用户想得到的结果，再根据各 Skill 的适用意图选择必要流程；一个请求可组合多个 Skill，共用已有条件与证据。简单问题直接处理，只有会改变结果的关键缺项才澄清；不向用户展示内部意图梳理过程。通用数据与权限规则以系统提示词和工具定义为准，交付前按所选流程的完成标准核对实际结果。",
		...loaded.skills.map(
			(skill) =>
				`<industrial_skill name="${skill.name}">\n${readFileSync(skill.filePath, "utf8").trim()}\n</industrial_skill>`,
		),
	].join("\n\n");
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => loaded,
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () =>
			`${industrialSystemPrompt}\n本轮当前时刻（UTC）：${new Date().toISOString()}；北京时间为UTC+08:00。`,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [instructions],
		getAppendSystemPromptSources: () => loaded.skills.map((skill) => ({ path: skill.filePath })),
		extendResources: () => {},
		reload: async () => {},
	};
}
