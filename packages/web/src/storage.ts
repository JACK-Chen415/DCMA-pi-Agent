import { createDemoDatasets, defaultSettings, initialDevices } from "./mockData.ts";
import { parseTelemetry } from "./telemetry.ts";
import type { AppSettings, ChatMessage, ConversationItem, Dataset, ToolId } from "./types.ts";

function restoreReport(value: unknown): ChatMessage["structuredData"] {
	if (!value || typeof value !== "object") return undefined;
	const report = value as Record<string, unknown>;
	if (
		!["diagnostic_report", "sensor_chart", "maintenance_plan", "fault_code"].includes(String(report.type)) ||
		typeof report.title !== "string" ||
		typeof report.source !== "string"
	)
		return undefined;
	const metrics =
		report.metrics && typeof report.metrics === "object"
			? Object.fromEntries(
					Object.entries(report.metrics).filter(
						(entry): entry is [string, string] => typeof entry[1] === "string",
					),
				)
			: undefined;
	const chartData = Array.isArray(report.chartData)
		? report.chartData.slice(0, 10000).flatMap((item: unknown) => {
				if (!item || typeof item !== "object") return [];
				const point = item as Record<string, unknown>;
				if (typeof point.name !== "string" || typeof point.value !== "number" || !Number.isFinite(point.value))
					return [];
				return [
					{
						name: point.name,
						value: point.value,
						time: typeof point.time === "number" && Number.isFinite(point.time) ? point.time : undefined,
					},
				];
			})
		: undefined;
	return {
		type: report.type as NonNullable<ChatMessage["structuredData"]>["type"],
		title: report.title,
		source: report.source,
		metrics,
		chartData,
		chartLabel: typeof report.chartLabel === "string" ? report.chartLabel : undefined,
		threshold:
			typeof report.threshold === "number" && Number.isFinite(report.threshold) ? report.threshold : undefined,
		recommendations: Array.isArray(report.recommendations)
			? report.recommendations.filter((item): item is string => typeof item === "string")
			: undefined,
	};
}

export const storageKey = "dcma-workspace-v1";
const tools: ToolId[] = ["scada_telemetry", "fault_kb", "pi_agent_harness", "auto_report"];
export interface WorkspaceState {
	conversations: ConversationItem[];
	activeId: string | null;
	deviceId: string;
	settings: AppSettings;
	datasets: Record<string, Dataset>;
}
export function loadWorkspace(): WorkspaceState {
	const initial: WorkspaceState = {
		conversations: [],
		activeId: null,
		deviceId: initialDevices[0].id,
		settings: defaultSettings,
		datasets: createDemoDatasets(),
	};
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
		if (!raw || typeof raw !== "object") return initial;
		const value = raw as Record<string, unknown>;
		const saved = value.settings;
		if (saved && typeof saved === "object") {
			const settings = saved as Record<string, unknown>;
			initial.settings = {
				mode: settings.mode === "pi" ? "pi" : "local",
				model: typeof settings.model === "string" ? settings.model : "",
				telemetryIntervalMs: [1000, 3000, 5000].includes(Number(settings.telemetryIntervalMs))
					? Number(settings.telemetryIntervalMs)
					: 3000,
				alarmThreshold:
					typeof settings.alarmThreshold === "number" &&
					settings.alarmThreshold >= 0 &&
					settings.alarmThreshold <= 150
						? settings.alarmThreshold
						: 75,
				enabledTools: Array.isArray(settings.enabledTools)
					? settings.enabledTools.filter((tool): tool is ToolId => tools.includes(tool))
					: defaultSettings.enabledTools,
			};
		}
		if (typeof value.deviceId === "string" && initialDevices.some((device) => device.id === value.deviceId))
			initial.deviceId = value.deviceId;
		if (Array.isArray(value.conversations)) {
			initial.conversations = value.conversations.slice(0, 50).flatMap((entry: unknown) => {
				if (!entry || typeof entry !== "object") return [];
				const conversation = entry as Record<string, unknown>;
				if (
					typeof conversation.id !== "string" ||
					typeof conversation.title !== "string" ||
					typeof conversation.time !== "string" ||
					typeof conversation.deviceId !== "string" ||
					!Array.isArray(conversation.messages)
				)
					return [];
				const messages = conversation.messages.slice(-200).flatMap((item: unknown) => {
					if (!item || typeof item !== "object") return [];
					const message = item as Record<string, unknown>;
					if (
						typeof message.id !== "string" ||
						(message.role !== "user" && message.role !== "assistant") ||
						typeof message.content !== "string" ||
						typeof message.timestamp !== "string"
					)
						return [];
					return [
						{
							id: message.id,
							role: message.role,
							content: message.content,
							timestamp: message.timestamp,
							engine: typeof message.engine === "string" ? message.engine : undefined,
							structuredData: restoreReport(message.structuredData),
							status:
								message.status === "error"
									? ("error" as const)
									: message.status === "streaming" || message.status === "cancelled"
										? ("cancelled" as const)
										: ("done" as const),
						},
					];
				});
				return [
					{
						id: conversation.id,
						title: conversation.title,
						time: conversation.time,
						deviceId: conversation.deviceId,
						messages,
					} as ConversationItem,
				];
			});
		}
		if (
			typeof value.activeId === "string" &&
			initial.conversations.some((conversation) => conversation.id === value.activeId)
		)
			initial.activeId = value.activeId;
		if (value.datasets && typeof value.datasets === "object") {
			for (const device of initialDevices) {
				const savedData: unknown = (value.datasets as Record<string, unknown>)[device.id];
				if (!savedData || typeof savedData !== "object") continue;
				const dataset = savedData as Record<string, unknown>;
				if (!Array.isArray(dataset.samples) || !dataset.imported || typeof dataset.source !== "string") continue;
				try {
					const restored = parseTelemetry(
						dataset.samples.map((sample: unknown) => JSON.stringify(sample)).join("\n"),
						"历史导入数据",
					);
					initial.datasets[device.id] = { ...restored, source: dataset.source };
				} catch {
					/* A damaged dataset must not prevent loading other conversations. */
				}
			}
		}
	} catch {
		/* Start with a usable workspace if storage is unavailable or corrupted. */
	}
	return initial;
}
