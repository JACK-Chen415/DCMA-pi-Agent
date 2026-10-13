import { fieldLabels, type DashboardField, type DashboardRecord } from "./database-types.ts";

export const fieldUnits: Partial<Record<DashboardField, string>> = {
	dc_voltage: "V", speed_setpoint: "rpm", speed_actual: "rpm", current_actual: "A",
	torque_setpoint: "N·m", torque_actual: "N·m", air_intake_temp: "°C", motor_temp: "°C",
	inverter_temp: "°C", actual_power: "kW", field_current: "A", torque_current: "A",
	inverter_radiator_temp: "°C", inverter_load_rate: "%", motor_load_rate: "%",
	motor_power: "kW", feedback_power: "kW", pulse_frequency: "kHz",
};

export function displayFieldLabel(field: DashboardField): string {
	return fieldUnits[field] ? `${fieldLabels[field]}（${fieldUnits[field]}）` : fieldLabels[field];
}

export function displayRawField(_field: DashboardField, value: unknown): string {
	return displayRaw(value);
}

export function codeClassName(field: DashboardField, value: unknown): string | undefined {
	if (value === null || value === undefined || value === "" || value === 0 || value === "0") return undefined;
	return field === "fault_code" ? "fault-code-active" : field === "alarm_code" ? "alarm-code-active" : undefined;
}

export function displayValue(value: unknown, maximumFractionDigits = 4): string {
	if (value === null || value === undefined || value === "") return "—";
	return typeof value === "number" ? value.toLocaleString("zh-CN", { maximumFractionDigits }) : String(value);
}

export function displayRaw(value: unknown): string {
	return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function displayTime(value: string | null | undefined, timeOnly = false, precise = false): string {
	if (!value) return "—";
	return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ...(timeOnly ? {} : { year: "numeric", month: "2-digit", day: "2-digit" }), hour: "2-digit", minute: "2-digit", second: "2-digit", ...(precise ? { fractionalSecondDigits: 3 } : {}), hour12: false }).format(new Date(value));
}

export function sampleIdentity(record: DashboardRecord | null): string {
	return record ? `${record.id}/${record.acquiredAt ?? record.raw.timestamp}` : "";
}

export function sampleRange(values: (number | null)[]): { min: number; max: number } | null {
	const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
	if (!valid.length) return null;
	const min = Math.min(...valid);
	const max = Math.max(...valid);
	if (min !== max) return { min, max };
	const padding = Math.max(Math.abs(min) * 0.1, 1);
	return { min: min - padding, max: max + padding };
}

export function linePath(points: { x: number; y: number | null }[]): string {
	let connected = false;
	return points.map((point) => {
		if (point.y === null) { connected = false; return ""; }
		const command = `${connected ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
		connected = true;
		return command;
	}).join(" ").trim();
}
