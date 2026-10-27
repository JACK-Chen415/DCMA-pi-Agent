export const exportStatusEvent = "dcma-export-status";
export type ExportResult = { kind: "saved"; path: string } | { kind: "download"; name: string } | { kind: "cancelled" };
interface DownloadAnchor {
	href: string;
	download: string;
	click(): void;
	remove(): void;
}

export function exportResultMessage(result: ExportResult): string {
	if (result.kind === "saved") return `已保存：${result.path}`;
	if (result.kind === "download") return `已交由浏览器下载：${result.name}。保存位置请查看浏览器下载记录。`;
	return "已取消保存。";
}
function notify(message: string): void {
	(globalThis as unknown as { window?: EventTarget }).window?.dispatchEvent(
		new CustomEvent(exportStatusEvent, { detail: message }),
	);
}
export async function saveExportFile(name: string, file: Blob): Promise<ExportResult> {
	notify("正在准备导出…");
	try {
		const response = await fetch("/api/exports", {
			method: "POST",
			headers: { "Content-Type": file.type, "X-DCMA-Client": "web", "X-DCMA-Filename": encodeURIComponent(name) },
			body: file,
		});
		const value: unknown = await response.json();
		if (!response.ok || !value || typeof value !== "object")
			throw new Error(
				value && typeof value === "object" && "error" in value && typeof value.error === "string"
					? value.error
					: "文件保存失败，请检查本机服务。",
			);
		let result: ExportResult;
		if ("cancelled" in value && value.cancelled === true) result = { kind: "cancelled" };
		else if ("browserDownload" in value && value.browserDownload === true) {
			const document = (
				globalThis as unknown as {
					document?: {
						createElement(tag: "a"): DownloadAnchor;
						body: { appendChild(link: DownloadAnchor): void };
					};
				}
			).document;
			if (!document) throw new Error("当前环境不支持浏览器下载，请在浏览器中导出。");
			const link = document.createElement("a");
			const url = URL.createObjectURL(file);
			try {
				link.href = url;
				link.download = name;
				document.body.appendChild(link);
				link.click();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			} catch (error) {
				URL.revokeObjectURL(url);
				throw error;
			} finally {
				link.remove();
			}
			result = { kind: "download", name };
		} else if ("path" in value && typeof value.path === "string" && value.path) {
			result = { kind: "saved", path: value.path };
		} else throw new Error("文件保存结果无效，请重试。");
		notify(exportResultMessage(result));
		return result;
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
