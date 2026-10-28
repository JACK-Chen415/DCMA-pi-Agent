import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** Separate assistant messages while preserving every provider chunk within each message. */
export function createTextStream() {
	let hasText = false;
	let boundary = false;
	return (event: AgentSessionEvent): string => {
		if (event.type === "message_end" && event.message.role === "assistant") boundary = hasText;
		if (event.type !== "message_update" || event.assistantMessageEvent.type !== "text_delta") return "";
		const delta = event.assistantMessageEvent.delta;
		if (!delta) return "";
		const text = (boundary ? "\n\n" : "") + delta;
		boundary = false;
		hasText = true;
		return text;
	};
}
