import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	createExtensionRuntime,
	loadSkillsFromDir,
	type ResourceLoader,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import { industrialSystemPrompt } from "./prompt.ts";

/** Loads a skill body on demand for the load_skill tool; returns null when the name is unknown. */
export function loadIndustrialSkillBody(name: string): string | null {
	const skill: Skill | undefined = loadSkillsFromDir({
		dir: fileURLToPath(new URL("../skills/", import.meta.url)),
		source: "project",
	}).skills.find((item) => item.name === name);
	return skill ? readFileSync(skill.filePath, "utf8").trim() : null;
}

export function createIndustrialResourceLoader(): ResourceLoader {
	const loaded = loadSkillsFromDir({ dir: fileURLToPath(new URL("../skills/", import.meta.url)), source: "project" });
	if (loaded.skills.length !== 5 || loaded.diagnostics.length) {
		throw new Error("工业 Skill 加载失败，请检查 packages/web/skills 中的五份 SKILL.md。");
	}
	loaded.skills.sort((a, b) => a.name.localeCompare(b.name));
	// The web agent has no file reader; skills are listed by name and description only and their
	// bodies are loaded on demand through the load_skill tool, keeping the resident prompt small.
	const instructions =
		"以下工业 Skill 仅列出名称与适用意图，正文不常驻。任务与某 Skill 的适用意图匹配、或需要其流程与完成标准时，先用load_skill工具取回正文再执行；一个请求可组合多个 Skill，共用已有条件与证据。简单问题直接处理，只有会改变结果的关键缺项才澄清；不向用户展示内部意图梳理过程。通用数据与权限规则以系统提示词和工具定义为准，交付前按所选流程的完成标准核对实际结果。";
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => loaded,
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => industrialSystemPrompt,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [
			`${instructions}\n\n${loaded.skills.map((skill) => `- ${skill.name}：${skill.description}`).join("\n")}`,
		],
		getAppendSystemPromptSources: () => loaded.skills.map((skill) => ({ path: skill.filePath })),
		extendResources: () => {},
		reload: async () => {},
	};
}
