import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const maximumHtmlBytes = 8 * 1024 * 1024;
const renderTimeoutMs = 90000;

const browserCandidates =
	process.platform === "win32"
		? [
				"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
				"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
				"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
				"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
			]
		: process.platform === "darwin"
			? [
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
					"/Applications/Chromium.app/Contents/MacOS/Chromium",
				]
			: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];

async function resolveBrowser(): Promise<string | undefined> {
	const configured = process.env.DCMA_BROWSER_PATH?.trim();
	const candidates = configured ? [configured, ...browserCandidates] : browserCandidates;
	for (const path of candidates) {
		try {
			await access(path, constants.X_OK);
			return path;
		} catch {
			/* Try the next known installation path. */
		}
	}
	return undefined;
}

/** Renders a self-contained HTML report to PDF with a local Chromium browser in headless mode. */
export async function renderHtmlToPdf(html: string, toolDirectory: string): Promise<Buffer> {
	const browser = await resolveBrowser();
	if (!browser) throw new Error("未找到可用于生成 PDF 的 Chrome 或 Edge；可先下载 HTML 报告，再用浏览器打印为 PDF。");
	const directory = join(toolDirectory, "pdf");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const id = randomUUID();
	const htmlPath = join(directory, `${id}.html`);
	const pdfPath = join(directory, `${id}.pdf`);
	const profilePath = join(directory, `profile-${id}`);
	try {
		await writeFile(htmlPath, html, { encoding: "utf8", mode: 0o600 });
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				browser,
				[
					"--headless=new",
					"--disable-gpu",
					"--disable-extensions",
					"--disable-dev-shm-usage",
					"--no-first-run",
					"--no-default-browser-check",
					"--no-pdf-header-footer",
					"--hide-scrollbars",
					"--mute-audio",
					`--user-data-dir=${profilePath}`,
					`--print-to-pdf=${pdfPath}`,
					pathToFileURL(htmlPath).href,
				],
				{ windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
			);
			let stderr = "";
			child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
				if (stderr.length < 8000) stderr += chunk;
			});
			const timer = setTimeout(() => {
				child.kill();
				reject(new Error("PDF 生成超时，请重试或改用 HTML 报告打印。"));
			}, renderTimeoutMs);
			child.on("error", (error) => {
				clearTimeout(timer);
				reject(new Error(`无法启动浏览器生成 PDF：${error.message}`));
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve();
				else
					reject(
						new Error(
							`浏览器未能生成 PDF（退出码 ${code ?? "未知"}）${stderr.trim() ? `：${stderr.trim().slice(0, 300)}` : ""}`,
						),
					);
			});
		});
		const pdf = await readFile(pdfPath);
		if (pdf.length < 5 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
			throw new Error("浏览器输出的 PDF 文件无效。");
		return pdf;
	} finally {
		await rm(htmlPath, { force: true }).catch(() => {});
		await rm(pdfPath, { force: true }).catch(() => {});
		await rm(profilePath, { recursive: true, force: true }).catch(() => {});
	}
}

function json(response: ServerResponse, status: number, body: unknown): void {
	if (response.destroyed) return;
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(JSON.stringify(body));
}

export async function handleReportPdfHttp(
	request: IncomingMessage,
	response: ServerResponse,
	toolDirectory: string,
): Promise<void> {
	if (request.method !== "POST") {
		json(response, 405, { error: "仅支持生成 PDF 报告。" });
		return;
	}
	if (request.headers["x-dcma-client"] !== "web") {
		json(response, 403, { error: "请从本机工作台导出报告。" });
		return;
	}
	if (!request.headers["content-type"]?.startsWith("text/html")) {
		json(response, 400, { error: "报告内容类型无效。" });
		return;
	}
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.length;
		if (bytes > maximumHtmlBytes) {
			json(response, 413, { error: "报告内容超过 8 MiB，无法生成 PDF。" });
			return;
		}
		chunks.push(buffer);
	}
	const html = Buffer.concat(chunks, bytes).toString("utf8");
	if (!html.trim()) {
		json(response, 400, { error: "报告内容为空。" });
		return;
	}
	try {
		const pdf = await renderHtmlToPdf(html, toolDirectory);
		response.writeHead(200, {
			"Content-Type": "application/pdf",
			"Content-Length": String(pdf.length),
			"Content-Disposition": 'attachment; filename="DCMA-report.pdf"',
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		response.end(pdf);
	} catch (error) {
		const message = error instanceof Error ? error.message : "PDF 生成失败。";
		json(response, message.includes("Chrome") || message.includes("Edge") ? 503 : 500, { error: message });
	}
}
