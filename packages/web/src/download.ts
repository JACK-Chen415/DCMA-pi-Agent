export function downloadText(name: string, text: string, mime = "text/plain;charset=utf-8"): void {
	const url = URL.createObjectURL(new Blob([text], { type: mime }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name.replace(/[\\/:*?"<>|]/gu, "_");
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
