export const exportStatusEvent = "dcma-export-status";
function notify(message: string): void {
	(globalThis as unknown as { window?: EventTarget }).window?.dispatchEvent(
		new CustomEvent(exportStatusEvent, { detail: message }),
	);
}
export async function saveExportFile(name: string, file: Blob): Promise<string> {
	notify("请在另存为窗口中选择保存位置…");
	try {
		const response = await fetch("/api/exports", {
			method: "POST",
			headers: { "Content-Type": file.type, "X-DCMA-Client": "web", "X-DCMA-Filename": encodeURIComponent(name) },
			body: file,
		});
		const value: unknown = await response.json();
		if (response.ok && value && typeof value === "object" && "cancelled" in value && value.cancelled === true) {
			notify("已取消保存。");
			return "";
		}
		if (!response.ok || !value || typeof value !== "object" || !("path" in value) || typeof value.path !== "string")
			throw new Error(
				value && typeof value === "object" && "error" in value && typeof value.error === "string"
					? value.error
					: "文件保存失败，请检查本机服务。",
			);
		notify(`已保存：${value.path}`);
		return value.path;
	} catch (error) {
		notify(error instanceof Error ? error.message : "文件保存失败，请重试。");
		throw error;
	}
}
export function downloadText(name: string, text: string, mime = "text/plain;charset=utf-8"): void {
	// Existing text export buttons report failures through the workspace status instead of dropping a promise.
	void saveExportFile(name, new Blob([text], { type: mime })).catch(() => {});
}

export function downloadSavedFile(url: string): void {
	void (async () => {
		if (!/^\/api\/tools\/(?:reports\/[0-9a-f-]{36}\.(?:md|json)|charts\/[0-9a-f-]{36}\.csv)$/.test(url))
			throw new Error("导出链接无效。");
		const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
		if (!response.ok) throw new Error("导出文件不可读取，可能已归档。");
		await saveExportFile(`DCMA-${url.slice(url.lastIndexOf("/") + 1)}`, await response.blob());
	})().catch((error: unknown) => notify(error instanceof Error ? error.message : "文件保存失败。"));
}
