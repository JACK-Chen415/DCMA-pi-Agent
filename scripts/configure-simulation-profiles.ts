import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dashboardTables, numericFields } from "../dashboard/database/dashboard-types.ts";
import { fieldUnits } from "../dashboard/frontend/src/dashboard-view.ts";

const output = process.argv[2]
	? resolve(process.argv[2])
	: fileURLToPath(new URL("../packages/web/.dcma-runtime/profiles.json", import.meta.url));

const simScenes: Record<string, { deviceName: string; scene: string }> = {
	real_data_01: { deviceName: "模拟电机1", scene: "沿用原有模拟数据" },
	real_data_02: { deviceName: "模拟电机2", scene: "沿用原有模拟数据" },
	real_data_03: { deviceName: "模拟电机3", scene: "沿用原有模拟数据" },
	real_data_04: { deviceName: "模拟电机4", scene: "沿用原有模拟数据" },
	sim_normal: { deviceName: "模拟电机-正常场景", scene: "正常运行，用于测试误报" },
	sim_f07900_blocked: { deviceName: "模拟电机-堵转场景", scene: "机械卡滞触发F07900堵转保护" },
	sim_f30002_overvoltage: { deviceName: "模拟电机-过电压场景", scene: "快速减速回馈触发F30002过电压保护" },
	sim_f07011_overtemp: { deviceName: "模拟电机-超温场景", scene: "持续过载触发F07011电机超温，含报警、停机和冷却恢复" },
};
// status uses RUNNING/STOPPED/FAULT strings in the simulation tables (g120_sim_v1).
const simStateRules = {
	source: "模拟数据g120_sim_v1状态字段约定（演示约定）",
	version: "g120_sim_v1",
	rules: [
		{ state: "running", all: [{ field: "status", operator: "eq", value: "RUNNING" }] },
		{ state: "stopped", all: [{ field: "status", operator: "eq", value: "STOPPED" }] },
		{ state: "fault", all: [{ field: "status", operator: "eq", value: "FAULT" }] },
	],
};

const profiles = dashboardTables
	.filter((table) => table !== "real_data")
	.map((table, index) => {
		const scene = simScenes[table];
		const isSim = table.startsWith("sim_");
		return {
			table,
			deviceName: scene?.deviceName ?? `模拟电机${index + 1}`,
			manufacturer: null,
			model: null,
			version: null,
			source: isSim
				? `G120模拟场景表（g120_sim_v1，每3秒新增一条、保留7天）；场景：${scene?.scene}。测点单位沿用展板 fieldUnits；status字段用RUNNING/STOPPED/FAULT字符串，字段含义以signal_metadata字典为准；物理参数属演示约定，未绑定真实电机型号或现场阈值。`
				: "用户确认电机1～4为模拟设备；测点单位沿用已确认的展板 fieldUnits；未绑定真实电机型号、额定值或异常阈值。",
			units: Object.fromEntries(
				numericFields.filter((field) => fieldUnits[field]).map((field) => [field, fieldUnits[field]]),
			),
			...(isSim ? { stateRules: simStateRules } : {}),
		};
	});

await mkdir(dirname(output), { recursive: true, mode: 0o700 });
// Existing local profiles may contain user settings; initialization must not overwrite them.
await writeFile(output, `${JSON.stringify({ profiles }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(`已配置${profiles.length}个模拟来源：${output}`);
