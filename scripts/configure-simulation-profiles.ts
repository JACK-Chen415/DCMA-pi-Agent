import { link, mkdir, mkdtemp, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { dashboardTables } from "../dashboard/database/dashboard-types.ts";
import { measurementUnits } from "../dashboard/database/measurement-units.ts";
import { readDeviceProfiles } from "../packages/web/tools/knowledge.ts";

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
// The legacy real_data_01..04 tables only expose numeric status 0/42. In the observed demo data
// both occur with running speed and current; 42 also carries alarm A07089. This is an observation
// convention, not a vendor state-code definition, and is limited to the four simulated tables.
const legacyStateRules = {
	source:
		"DCMA演示数据观测约定：status为0或42时实测转速与电流均处于运行区间；未取得厂家状态码定义，仅用于real_data_01至04模拟表。",
	version: "dcma_observed_v1",
	rules: [
		{ state: "running", all: [{ field: "status", operator: "eq", value: "0" }] },
		{ state: "running", all: [{ field: "status", operator: "eq", value: "42" }] },
	],
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
			units: measurementUnits,
			stateRules: isSim ? simStateRules : legacyStateRules,
		};
	});

const directory = dirname(output);
await mkdir(directory, { recursive: true, mode: 0o700 });
const lock = `${output}.lock`;
await mkdir(lock, { mode: 0o700 });
try {
	const current = await readDeviceProfiles(output);
	const existing = current ?? [];
	const missing = profiles.filter(({ table }) => !existing.some((profile) => profile.table === table));
	// Fill the observation-based state rules for existing legacy simulated profiles without
	// touching user-provided names, units or other fields.
	const legacyTables = new Set(["real_data_01", "real_data_02", "real_data_03", "real_data_04"]);
	const upgraded = existing.map((profile) => {
		const source = profiles.find((item) => item.table === profile.table);
		return source?.stateRules && !profile.stateRules && legacyTables.has(profile.table)
			? { ...profile, stateRules: source.stateRules }
			: profile;
	});
	const changed = upgraded.some((profile, index) => profile !== existing[index]);
	if (missing.length || changed) {
		const staging = await mkdtemp(join(directory, ".profiles-"));
		try {
			const next = join(staging, "profiles.json");
			await writeFile(next, `${JSON.stringify({ profiles: [...upgraded, ...missing] }, null, 2)}\n`, { mode: 0o600 });
			await readDeviceProfiles(next);
			if (current === null) {
				await link(next, output);
			} else {
				if (!isDeepStrictEqual(current, await readDeviceProfiles(output)))
					throw new Error("设备资料在处理期间发生变化，请重新运行补齐命令。");
				await rename(next, output);
			}
		} finally {
			await rm(staging, { recursive: true });
		}
	}
	console.log(`已补齐${missing.length}个模拟来源，更新${changed ? "部分" : "0"}个状态规则，保留${existing.length}个已有来源：${output}`);
} finally {
	await rmdir(lock);
}
