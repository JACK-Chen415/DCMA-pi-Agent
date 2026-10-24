import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dashboardTables, numericFields } from "../dashboard/database/dashboard-types.ts";
import { fieldUnits } from "../dashboard/frontend/src/dashboard-view.ts";

const output = process.argv[2]
	? resolve(process.argv[2])
	: fileURLToPath(new URL("../packages/web/.dcma-runtime/profiles.json", import.meta.url));
const profiles = dashboardTables
	.filter((table) => table !== "real_data")
	.map((table, index) => ({
		table,
		deviceName: `模拟电机${index + 1}`,
		manufacturer: null,
		model: null,
		version: null,
		source:
			"用户确认电机1～4为模拟设备；测点单位沿用已确认的展板 fieldUnits；未绑定真实电机型号、额定值或异常阈值。",
		units: Object.fromEntries(
			numericFields.filter((field) => fieldUnits[field]).map((field) => [field, fieldUnits[field]]),
		),
	}));

await mkdir(dirname(output), { recursive: true, mode: 0o700 });
// Existing local profiles may contain user settings; initialization must not overwrite them.
await writeFile(output, `${JSON.stringify({ profiles }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(`已配置${profiles.length}个模拟来源：${output}`);
