export interface Device {
	id: string;
	code: string;
	name: string;
	type: string;
	location: string;
	commissionDate: string;
	status: "running" | "warning" | "stopped" | "maintenance";
	image: string;
}
export type MetricKey = "temperature" | "vibration" | "current" | "speed";
export type ToolId = "scada_telemetry" | "fault_kb" | "pi_agent_harness" | "auto_report";
export interface TelemetrySample {
	timestamp: string;
	temperature?: number;
	vibration?: number;
	current?: number;
	speed?: number;
}
export interface Dataset {
	source: string;
	imported: boolean;
	samples: TelemetrySample[];
}
export interface MetricData {
	id: MetricKey;
	label: string;
	value: string | number;
	unit: string;
	change: string;
	trend: "up" | "down" | "flat";
	accentColor: "blue" | "amber";
	sparkline: number[];
}
export interface ChartPoint {
	name: string;
	value: number;
	time?: number;
}
export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: string;
	status?: "streaming" | "done" | "error" | "cancelled";
	engine?: string;
	structuredData?: {
		type: "diagnostic_report" | "sensor_chart" | "maintenance_plan" | "fault_code";
		title: string;
		source: string;
		metrics?: Record<string, string>;
		chartData?: ChartPoint[];
		chartLabel?: string;
		threshold?: number;
		recommendations?: string[];
	};
}
export interface ConversationItem {
	id: string;
	title: string;
	time: string;
	deviceId: string;
	messages: ChatMessage[];
}
export interface AppSettings {
	mode: "local" | "pi";
	model: string;
	telemetryIntervalMs: number;
	alarmThreshold: number;
	enabledTools: ToolId[];
}
export interface BackendStatus {
	connected: boolean;
	models: { id: string; name: string }[];
	message: string;
}
export interface SuggestionCard {
	id: string;
	title: string;
	query: string;
	iconBg: string;
	iconColor: string;
	iconType: "search" | "chart" | "alert" | "clipboard";
}
