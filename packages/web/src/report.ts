import type { ChatMessage } from "./types.ts";

export function messageReport(message: ChatMessage): string {
	return `# DCMA 对话记录\n\n生成时间：${message.timestamp}\n分析引擎：${message.engine ?? "未指定"}\n\n${message.content}\n`;
}
