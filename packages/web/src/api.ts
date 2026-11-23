import { type ChartReference, validateChartReference } from "../chart-contracts.ts";
import { type ToolStep, updateToolSteps, validateToolSteps } from "../interaction-contracts.ts";
import type { BackendStatus, ModelConfigPayload } from "./types.ts";

export async function getBackendStatus(signal?: AbortSignal, refresh = false): Promise<BackendStatus> {
	const response = await fetch(refresh ? "/api/health?refresh=1" : "/api/health", { signal });
	if (!response.ok) throw new Error("本地后端未连接");
	return (await response.json()) as BackendStatus;
}

async function modelConfigRequest(path: string, init?: RequestInit): Promise<ModelConfigPayload & { ok?: boolean }> {
	const response = await fetch(path, init);
	const body: unknown = await response.json();
	if (!response.ok)
		throw new Error(
			body && typeof body === "object" && "error" in body && typeof body.error === "string"
				? body.error
				: `模型 API 配置请求失败（${response.status}）`,
		);
	if (!body || typeof body !== "object" || !("providers" in body)) throw new Error("模型 API 配置响应无效");
	return body as ModelConfigPayload & { ok?: boolean };
}

export function getModelConfig(signal?: AbortSignal, refresh?: "all" | string): Promise<ModelConfigPayload> {
	const query = refresh ? `?refresh=${encodeURIComponent(refresh)}` : "";
	return modelConfigRequest(`/api/model-config${query}`, { signal });
}

export function saveModelProvider(input: {
	provider: string;
	name?: string;
	baseUrl: string;
	apiKey?: string;
	discoverModels: boolean;
	models?: string[];
}): Promise<ModelConfigPayload> {
	return modelConfigRequest("/api/model-config", {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-DCMA-Client": "web" },
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(40000),
	});
}

export function deleteModelProvider(provider: string): Promise<ModelConfigPayload> {
	return modelConfigRequest(`/api/model-config?provider=${encodeURIComponent(provider)}`, {
		method: "DELETE",
		headers: { "X-DCMA-Client": "web" },
		signal: AbortSignal.timeout(40000),
	});
}

/** Renders a self-contained HTML report into a PDF through the local backend. */
export async function renderReportPdf(html: string): Promise<Blob> {
	const response = await fetch("/api/reports/pdf", {
		method: "POST",
		headers: { "Content-Type": "text/html;charset=utf-8", "X-DCMA-Client": "web" },
		body: html,
		signal: AbortSignal.timeout(120000),
	});
	if (!response.ok) {
		const body: unknown = await response.json().catch(() => null);
		throw new Error(
			body && typeof body === "object" && "error" in body && typeof body.error === "string"
				? body.error
				: `PDF 生成失败（${response.status}）`,
		);
	}
	return await response.blob();
}

export async function streamChat(
	payload: unknown,
	signal: AbortSignal,
	onDelta: (text: string) => void,
	onChart?: (chart: ChartReference) => void,
	onSnapshot?: (text: string, charts: ChartReference[]) => void,
	requestId?: string,
	onSteps?: (steps: ToolStep[]) => void,
): Promise<"done" | "cancelled"> {
	const response = await fetch(requestId ? `/api/chat/${encodeURIComponent(requestId)}` : "/api/chat", {
		method: requestId ? "GET" : "POST",
		headers: { "Content-Type": "application/json", "X-DCMA-Client": "web" },
		body: requestId ? undefined : JSON.stringify(payload),
		signal,
	});
	if (!response.ok) {
		const body: unknown = await response.json();
		throw new Error(
			body && typeof body === "object" && "error" in body && typeof body.error === "string"
				? body.error
				: `请求失败（${response.status}）`,
		);
	}
	if (!response.body) throw new Error("模型未返回响应流。");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let finished = false;
	let cancelled = false;
	let steps: ToolStep[] = [];
	const consume = (line: string) => {
		if (!line.trim()) return;
		const event: unknown = JSON.parse(line);
		if (!event || typeof event !== "object" || !("type" in event)) throw new Error("响应格式无效。");
		if (
			event.type === "snapshot" &&
			"text" in event &&
			typeof event.text === "string" &&
			"charts" in event &&
			Array.isArray(event.charts)
		) {
			const charts = event.charts.flatMap((value: unknown) => {
				const chart = validateChartReference(value);
				return chart ? [chart] : [];
			});
			steps = validateToolSteps("steps" in event ? event.steps : []);
			onSteps?.(steps);
			onSnapshot?.(event.text, charts);
		} else if (event.type === "tool_start" || event.type === "tool_end") {
			steps = updateToolSteps(steps, event as Record<string, unknown>);
			onSteps?.(steps);
		} else if (event.type === "delta" && "text" in event && typeof event.text === "string") onDelta(event.text);
		else if (event.type === "chart" && "chart" in event) {
			const chart = validateChartReference(event.chart);
			if (chart) onChart?.(chart);
		} else if (event.type === "error" && "message" in event && typeof event.message === "string")
			throw new Error(event.message);
		else if (event.type === "done") finished = true;
		else if (event.type === "cancelled") {
			cancelled = true;
			finished = true;
		}
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) consume(line);
			if (done) break;
		}
		consume(buffer);
		if (!finished) throw new Error("模型连接提前结束，可以重新发送问题。");
		return cancelled ? "cancelled" : "done";
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export async function cancelChat(requestId: string): Promise<void> {
	const response = await fetch(`/api/chat/${encodeURIComponent(requestId)}`, {
		method: "DELETE",
		headers: { "X-DCMA-Client": "web" },
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok && response.status !== 404) throw new Error("停止生成失败，请检查本地服务后重试。");
}
