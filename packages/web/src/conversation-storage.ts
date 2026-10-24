import {
	type ConversationState,
	conversationState,
	type SavedConversations,
	validateConversations,
} from "./conversation-state.ts";

export const conversationBackupKey = "dcma-conversations-pending-v1";

export function createConversationStorage(reportError: (message: string) => void) {
	let revision: number | null = null;
	let latest: ConversationState | undefined;
	let lastSaved = "";
	let streaming = false;
	let saving: Promise<void> | undefined;
	let blocked = false;
	let disposed = false;
	const timer = setInterval(() => void flush(), 1000);

	function backup() {
		if (!latest || revision === null) return;
		try {
			localStorage.setItem(conversationBackupKey, JSON.stringify({ ...latest, version: 1, revision }));
		} catch {
			// The server save still works when browser storage is unavailable.
		}
	}
	function flush(keepalive = false): Promise<void> {
		if (keepalive && !disposed) backup();
		if (saving || disposed || blocked || revision === null || !latest) return saving ?? Promise.resolve();
		const snapshot = latest;
		const content = JSON.stringify(snapshot);
		if (content === lastSaved) return Promise.resolve();
		backup();
		const expectedRevision = revision + 1;
		saving = (async () => {
			let succeeded = false;
			try {
				const response = await fetch("/api/conversations", {
					method: "PUT",
					headers: { "Content-Type": "application/json", "X-DCMA-Client": "web" },
					body: JSON.stringify({ ...snapshot, version: 1, revision }),
					signal: AbortSignal.timeout(15000),
					keepalive,
				});
				const result: unknown = await response.json();
				if (!response.ok) {
					if (response.status === 409) blocked = true;
					throw new Error(
						result && typeof result === "object" && "error" in result && typeof result.error === "string"
							? result.error
							: "本机聊天记录保存失败，请导出当前记录。",
					);
				}
				if (
					!result ||
					typeof result !== "object" ||
					!("revision" in result) ||
					result.revision !== expectedRevision
				)
					throw new Error("本机聊天记录保存结果无效，请导出当前记录后刷新。");
				revision = expectedRevision;
				lastSaved = content;
				succeeded = true;
				if (!disposed) {
					backup();
					reportError("");
				}
			} catch (error) {
				if (!disposed)
					reportError(error instanceof Error ? error.message : "本机聊天记录保存失败，请导出当前记录。");
			} finally {
				saving = undefined;
				if (succeeded && !streaming && latest && JSON.stringify(latest) !== lastSaved)
					queueMicrotask(() => void flush());
			}
		})();
		return saving;
	}
	return {
		async load(local: ConversationState): Promise<ConversationState> {
			const response = await fetch("/api/conversations", { signal: AbortSignal.timeout(15000) });
			if (!response.ok) throw new Error("本机聊天记录读取失败，尚未覆盖任何记录。请检查本地服务后重试。");
			const value: unknown = await response.json();
			const saved = value === null ? null : validateConversations(value);
			revision = saved?.revision ?? 0;
			lastSaved = saved ? JSON.stringify(conversationState(saved)) : "";
			let pending: SavedConversations | undefined;
			try {
				const raw = localStorage.getItem(conversationBackupKey);
				if (raw) pending = validateConversations(JSON.parse(raw));
			} catch {
				// An unavailable browser cache must not prevent reading the server copy.
			}
			return conversationState(pending?.revision === revision ? pending : (saved ?? local));
		},
		update(state: ConversationState, isStreaming: boolean) {
			latest = conversationState(state);
			const immediate = !isStreaming || !streaming;
			streaming = isStreaming;
			if (immediate) void flush();
		},
		async checkpoint(state: ConversationState) {
			latest = conversationState(state);
			if (saving) await saving;
			await flush();
			if (JSON.stringify(latest) !== lastSaved)
				throw new Error("消息尚未保存，暂未发起生成。请检查本地服务后重新发送。");
		},
		flush,
		dispose() {
			disposed = true;
			clearInterval(timer);
		},
	};
}
