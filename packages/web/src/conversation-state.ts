import { validateChartReference } from "../chart-contracts.ts";
import { validateToolSteps } from "../interaction-contracts.ts";
import type { ConversationItem } from "./types.ts";

export interface ConversationState {
	conversations: ConversationItem[];
	activeId: string | null;
	deviceId: string;
}
export interface SavedConversations extends ConversationState {
	version: 1;
	revision: number;
}
export const maximumConversationBytes = 32 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, maximum: number): value is string {
	return typeof value === "string" && value.length <= maximum;
}
export function validateConversations(value: unknown): SavedConversations {
	if (
		!record(value) ||
		value.version !== 1 ||
		!Number.isSafeInteger(value.revision) ||
		Number(value.revision) < 0 ||
		!text(value.deviceId, 100) ||
		!Array.isArray(value.conversations) ||
		value.conversations.length > 50
	)
		throw new Error("聊天记录格式无效或版本不支持。");
	const ids = new Set<string>();
	for (const conversation of value.conversations) {
		if (
			!record(conversation) ||
			!text(conversation.id, 100) ||
			!conversation.id ||
			ids.has(conversation.id) ||
			!text(conversation.title, 1000) ||
			!text(conversation.time, 100) ||
			!text(conversation.deviceId, 100) ||
			!Array.isArray(conversation.messages) ||
			conversation.messages.length > 200
		)
			throw new Error("会话格式无效或超过数量限制。");
		ids.add(conversation.id);
		const messageIds = new Set<string>();
		for (const message of conversation.messages) {
			if (
				!record(message) ||
				!text(message.id, 100) ||
				!message.id ||
				messageIds.has(message.id) ||
				!["user", "assistant"].includes(String(message.role)) ||
				!text(message.content, maximumConversationBytes) ||
				!text(message.timestamp, 100) ||
				(message.status !== undefined &&
					!["streaming", "done", "error", "cancelled"].includes(String(message.status))) ||
				(message.engine !== undefined && !text(message.engine, 1000)) ||
				(message.steps !== undefined &&
					(!Array.isArray(message.steps) ||
						JSON.stringify(validateToolSteps(message.steps)) !== JSON.stringify(message.steps))) ||
				(message.charts !== undefined &&
					(!Array.isArray(message.charts) ||
						message.charts.length > 3 ||
						message.charts.some((chart: unknown) => !validateChartReference(chart))))
			)
				throw new Error("消息格式无效。");
			messageIds.add(message.id);
		}
	}
	if (value.activeId !== null && (!text(value.activeId, 100) || !ids.has(value.activeId)))
		throw new Error("当前会话不存在。");
	return value as unknown as SavedConversations;
}

export function conversationState(value: ConversationState): ConversationState {
	return { conversations: value.conversations, activeId: value.activeId, deviceId: value.deviceId };
}
