import { spawn } from "node:child_process";
import { dirname, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

let initialDirectory = "D:\\";
let active = false;

/** Only the native dialog can supply a destination; HTTP clients cannot choose a server path. */
export async function chooseExportPath(name: string, signal: AbortSignal): Promise<string | null> {
	if (process.platform !== "win32") throw new Error("另存为需要在本机 Windows 服务中使用。");
	if (active) throw new Error("请先完成或取消已打开的另存为窗口。");
	active = true;
	try {
		const output = await new Promise<string>((resolve, reject) => {
			const child = spawn(
				"powershell.exe",
				["-NoProfile", "-STA", "-File", fileURLToPath(new URL("./save-dialog.ps1", import.meta.url))],
				{
					windowsHide: true,
					signal,
					stdio: ["ignore", "pipe", "pipe"],
					env: {
						...process.env,
						DCMA_EXPORT_OPTIONS: Buffer.from(
							JSON.stringify({ name, directory: initialDirectory, extension: extname(name) }),
						).toString("base64"),
					},
				},
			);
			let stdout = "";
			child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr.resume();
			child.on("error", reject);
			child.on("close", (code) =>
				code === 0 ? resolve(stdout) : reject(new Error("无法打开另存为窗口，请重试。")),
			);
		});
		const path: unknown = JSON.parse(output.replace(/^\uFEFF/, ""));
		if (path === null) return null;
		if (typeof path !== "string" || !isAbsolute(path) || extname(path).toLowerCase() !== extname(name).toLowerCase())
			throw new Error("请选择与导出格式一致的文件名。");
		if (/^c:/i.test(path)) throw new Error("请重新选择 C 盘以外的保存位置。");
		initialDirectory = dirname(path);
		return path;
	} finally {
		active = false;
	}
}
