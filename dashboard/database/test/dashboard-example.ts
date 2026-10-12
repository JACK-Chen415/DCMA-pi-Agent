import { makeDashboardData } from "../dashboard-data.ts";
import { dashboardTables, numericFields } from "../dashboard-types.ts";

// 开发测试专用，正式页面从不自动加载此样例。
export function dashboardExample() {
	const rows = Array.from({ length: 100 }, (_, index) => ({
		id: String(100 - index), timestamp: `2026-10-10 12:${String(6 - Math.floor(index / 15)).padStart(2, "0")}:${String((14 - index % 15) * 4).padStart(2, "0")}`,
		device_name: "开发样例电机1", inverter_name: "开发样例G120", create_time: "2026-10-10 12:07:00", status: "0", fault_code: "0", alarm_code: "A2062", system_run_time: "0000:00:00",
		...Object.fromEntries(numericFields.map((field) => [field, field === "air_intake_temp" ? -200 : field === "speed_actual" ? 980 + Math.sin(index / 8) * 20 : field === "speed_setpoint" ? 1000 : index === 20 ? null : 0])),
	}));
	return makeDashboardData("real_data_01", 100, dashboardTables.map((table, index) => ({ table, deviceIndex: index === 4 ? 1 : index + 1, kind: table === "real_data" ? "acquired" : "simulation", available: true, latest: null, message: "开发样例，不代表实际采集" })), rows, true);
}
