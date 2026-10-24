import type { ServerResponse } from "node:http";
import { type ChartReference, validateChartReference } from "../chart-contracts.ts";
import { type ToolStep, updateToolSteps } from "../interaction-contracts.ts";

export const chatRunIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface ChatRun {
	signal: AbortSignal;
	readonly finished: boolean;
	emit(event: Record<string, unknown>): void;
	cancel(): void;
	attach(response: ServerResponse): void;
}

function createChatRun(): ChatRun {
	const controller = new AbortController();
	const clients = new Set<ServerResponse>();
	let text = "";
	const charts: ChartReference[] = [];
	let steps: ToolStep[] = [];
	let terminal: { type: "done" | "cancelled" } | { type: "error"; message: string } | undefined;
	const emit = (event: Record<string, unknown>) => {
		if (terminal) return;
		steps = updateToolSteps(steps, event);
		if (event.type === "delta" && typeof event.text === "string") text += event.text;
		if (event.type === "chart") {
			const chart = validateChartReference(event.chart);
			if (chart && charts.length < 3 && !charts.some((item) => item.id === chart.id)) charts.push(chart);
		}
		if (event.type === "done" || event.type === "cancelled") terminal = { type: event.type };
		if (event.type === "error" && typeof event.message === "string")
			terminal = { type: "error", message: event.message };
		for (const client of clients) {
			if (!client.destroyed) {
				client.write(`${JSON.stringify(event)}\n`);
				if (terminal) client.end();
			}
		}
		if (terminal) clients.clear();
	};
	return {
		signal: controller.signal,
		get finished() {
			return terminal !== undefined;
		},
		emit,
		cancel() {
			if (terminal) return;
			emit({ type: "cancelled" });
			controller.abort();
		},
		attach(response: ServerResponse) {
			if (response.destroyed) return;
			response.writeHead(200, {
				"Content-Type": "application/x-ndjson; charset=utf-8",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			});
			response.write(`${JSON.stringify({ type: "snapshot", text, charts, steps })}\n`);
			if (terminal) {
				response.end(`${JSON.stringify(terminal)}\n`);
				return;
			}
			clients.add(response);
			// A browser disconnect only removes its subscriber; cancellation is explicit.
			response.once("close", () => clients.delete(response));
		},
	};
}

/** Keep active generations and the last 100 completed replies for browser reconnection. */
export function createChatRuns() {
	const runs = new Map<string, ReturnType<typeof createChatRun>>();
	return {
		get: (id: string) => runs.get(id),
		create(id: string) {
			if (!chatRunIdPattern.test(id) || runs.has(id)) throw new Error("生成任务编号无效或已存在。");
			let completed = [...runs.values()].filter((run) => run.finished).length;
			for (const [key, run] of runs) {
				if (completed < 100) break;
				if (run.finished) {
					runs.delete(key);
					completed--;
				}
			}
			const run = createChatRun();
			runs.set(id, run);
			return run;
		},
	};
}
