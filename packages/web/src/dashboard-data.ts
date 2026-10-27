import type {
	DashboardData,
	DashboardSource,
	DashboardTable,
	DeviceAssessment,
	NumericField,
} from "../../../dashboard/database/dashboard-types.ts";
import type { Dataset, Device, MetricData } from "./types.ts";

export type { DashboardTable } from "../../../dashboard/database/dashboard-types.ts";
export { dashboardTables } from "../../../dashboard/database/dashboard-types.ts";
export { useDashboard } from "../../../dashboard/frontend/src/useDashboard.ts";

export function databaseDevice(table: DashboardTable, source?: DashboardSource, error = "", now = Date.now()): Device {
	let assessment: DeviceAssessment = source?.assessment ?? {
		state: "unknown",
		label: "状态未确认",
		tone: "neutral",
		detail: "等待取得最新采样及状态评估。",
		latestAt: source?.latest?.acquiredAt ?? null,
		assessedAt: new Date(now).toISOString(),
		expiresAt: null,
	};
	const expires = assessment.expiresAt === null ? null : Date.parse(assessment.expiresAt);
	if (error || (expires !== null && (!Number.isFinite(expires) || now > expires))) {
		assessment = {
			...assessment,
			state: "unknown",
			tone: "neutral",
			label: error ? "状态未确认" : "数据已过期",
			detail: error
				? `当前状态无法确认：${error}。保留的上次读数不代表当前状态。`
				: "最新采样超过60秒未更新，不能确认当前状态。",
			expiresAt: null,
		};
	}
	return {
		id: table,
		code: table,
		name: String(source?.latest?.raw.device_name || "等待设备数据"),
		type: "未提供",
		location: "未提供",
		commissionDate: "未提供",
		status: assessment.state,
		sourceLabel: table === "real_data" ? "历史采集" : "模拟数据",
		assessment,
		image: "/assets/gen_photo.png",
	};
}

export function databaseDataset(table: DashboardTable, data: DashboardData | null): Dataset {
	return {
		source: `dcma.${table} · ${table === "real_data" ? "历史真实采集" : "模拟数据"}`,
		imported: false,
		samples: (data?.samples ?? []).map((sample) => ({
			timestamp: sample.acquiredAt,
			...(sample.values.motor_temp === null ? {} : { temperature: sample.values.motor_temp }),
			...(sample.values.current_actual === null ? {} : { current: sample.values.current_actual }),
			...(sample.values.speed_actual === null ? {} : { speed: sample.values.speed_actual }),
		})),
	};
}

export function databaseMetrics(data: DashboardData | null): MetricData[] {
	const fields: { id: MetricData["id"]; field: NumericField; label: string; unit: string }[] = [
		{ id: "temperature", field: "motor_temp", label: "电机温度", unit: "℃" },
		{ id: "voltage", field: "dc_voltage", label: "直流电压", unit: "V" },
		{ id: "current", field: "current_actual", label: "实际电流", unit: "A" },
		{ id: "speed", field: "speed_actual", label: "实际转速", unit: "rpm" },
	];
	return fields.map(({ id, field, label, unit }) => {
		const value = data?.latest?.values[field] ?? null;
		const previous = data?.records[1]?.values[field] ?? null;
		const delta = value !== null && previous !== null ? value - previous : null;
		return {
			id,
			label,
			unit,
			value: value === null ? "—" : Number(value.toFixed(4)),
			change: delta === null ? "无前值" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`,
			trend: delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down",
			accentColor: "blue",
			sparkline: [],
			points: (data?.samples ?? []).slice(-24).map((sample) => ({
				name: sample.acquiredAt,
				time: Date.parse(sample.acquiredAt),
				value: sample.values[field],
			})),
		};
	});
}
