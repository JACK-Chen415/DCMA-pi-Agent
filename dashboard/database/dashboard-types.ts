export const dashboardTables = ["real_data_01", "real_data_02", "real_data_03", "real_data_04", "real_data"] as const;
export type DashboardTable = (typeof dashboardTables)[number];

export const numericFields = [
	"dc_voltage", "speed_setpoint", "speed_actual", "current_actual", "torque_setpoint", "torque_actual",
	"air_intake_temp", "motor_temp", "inverter_temp", "actual_power", "field_current", "torque_current",
	"inverter_radiator_temp", "inverter_load_rate", "motor_load_rate", "pulse_frequency", "motor_power", "feedback_power",
] as const;
export type NumericField = (typeof numericFields)[number];

export const fieldLabels = {
	id: "记录编号", timestamp: "原始采集时间", device_name: "设备名称", inverter_name: "变频器名称",
	date: "原始日期", time: "原始时刻", status: "状态码", fault_code: "故障码", alarm_code: "报警码",
	control_word: "控制字", status_word: "状态字", dc_voltage: "直流母线电压", speed_setpoint: "设定转速",
	speed_actual: "实际转速", current_actual: "实际电流", torque_setpoint: "设定转矩", torque_actual: "实际转矩",
	air_intake_temp: "进气温度", motor_temp: "电机温度", inverter_temp: "变频器温度", actual_power: "实际功率",
	field_current: "励磁电流", torque_current: "转矩电流", system_run_time: "系统运行时间",
	inverter_radiator_temp: "变频器散热器温度", inverter_load_rate: "变频器负荷率", motor_load_rate: "电机负荷率",
	pulse_frequency: "脉冲频率", motor_power: "电机功率", feedback_power: "反馈功率", create_time: "原始入库时间",
} as const;
export type DashboardField = keyof typeof fieldLabels;
export type RawRecord = Record<DashboardField, string | number | null>;

export interface DashboardRecord {
	id: string;
	acquiredAt: string | null;
	ingestedAt: string | null;
	values: Record<NumericField, number | null>;
	raw: RawRecord;
}
export interface DashboardSample {
	id: string;
	acquiredAt: string;
	values: Record<NumericField, number | null>;
}
export interface DashboardSource {
	table: DashboardTable;
	deviceIndex: number;
	kind: "simulation" | "acquired";
	available: boolean;
	latest: DashboardRecord | null;
	message: string;
	latestTimestampAmbiguous?: boolean;
	assessment?: DeviceAssessment;
}

export interface DeviceAssessment {
	state: "running" | "stopped" | "fault" | "warning" | "unknown";
	label: string;
	tone: "neutral" | "info" | "success" | "warning" | "danger";
	detail: string;
	latestAt: string | null;
	assessedAt: string;
	expiresAt: string | null;
	ruleSource?: { source: string; version: string };
}
export interface DashboardData {
	schema: "dcma";
	table: DashboardTable;
	limit: 50 | 100 | 200;
	queriedAt: string;
	sources: DashboardSource[];
	latest: DashboardRecord | null;
	records: DashboardRecord[];
	samples: DashboardSample[];
	returned: number;
	hasMore: boolean;
	truncated: boolean;
	warnings: string[];
}

export interface DashboardRange {
	from: string;
	to: string;
}
export interface DashboardHistory extends DashboardData, DashboardRange {
	page: number;
	total: number;
}

export type CodeField = "fault_code" | "alarm_code";
export interface CodeEvent {
	id: string;
	field: CodeField;
	code: string;
	startedAt: string;
	endedAt: string | null;
	lastSeenAt: string;
	samples: number;
	ending: "zero" | "changed" | null;
	startUncertain: boolean;
	hasMissingSamples: boolean;
}
export interface CodeHistory {
	table: DashboardTable;
	queriedAt: string;
	page: number;
	pageSize: number;
	total: number;
	faults: number;
	alarms: number;
	open: number;
	invalidTimes: number;
	events: CodeEvent[];
	codes: { field: CodeField; code: string; count: number; durationMs: number }[];
}
