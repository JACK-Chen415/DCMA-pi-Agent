import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type DashboardTable, dashboardTables, numericFields } from "../../dashboard/database/dashboard-types.ts";
import {
	databaseError,
	getDatabaseCatalog,
	readDashboard,
	readDatabaseRows,
} from "../../dashboard/database/database.ts";

export {
	closeDatabase,
	databaseConfigured,
	databaseError,
	getDatabaseCatalog,
	readDatabaseRows,
} from "../../dashboard/database/database.ts";

export function createDatabaseTools(selectedTable: DashboardTable) {
	let remaining = 8;
	return [
		defineTool({
			name: "read_industrial_dashboard",
			label: "读取当前设备监测数据",
			description:
				"读取与聊天页和展板一致的当前来源、最新记录和最近100条采样。默认使用当前选择，只有用户明确指定其他来源时才更换。返回模拟或历史真实数据，不代表全库统计；状态字不作解码。",
			parameters: Type.Object({
				table: Type.Optional(Type.Union(dashboardTables.map((table) => Type.Literal(table)))),
			}),
			async execute(_id, params, signal) {
				if (remaining-- <= 0) throw new Error("本轮数据库查询次数已达到上限。");
				try {
					const result = await readDashboard(params.table ?? selectedTable, 100, signal);
					const report = {
						schema: result.schema,
						table: result.table,
						queriedAt: result.queriedAt,
						latest: result.latest,
						columns: ["id", "acquiredAt", ...numericFields],
						rows: result.samples.map((sample) => [
							sample.id,
							sample.acquiredAt,
							...numericFields.map((field) => sample.values[field]),
						]),
						returned: result.returned,
						hasMore: result.hasMore,
						truncated: result.truncated,
						warnings: result.warnings,
						note: "与展板同源的最近采样窗口；不是全库统计。时间按展板暂定北京时间解释。模拟和历史真实来源必须区分，状态字未解码。rows按采集时间升序，与columns一一对应。",
					};
					while (Buffer.byteLength(JSON.stringify(report)) > 64000 && report.rows.length) {
						report.rows.shift();
						report.truncated = true;
					}
					if (Buffer.byteLength(JSON.stringify(report)) > 64000) throw new Error("DASHBOARD_RESULT_TOO_LARGE");
					report.returned = report.rows.length;
					return { content: [{ type: "text", text: JSON.stringify(report) }], details: { connected: true } };
				} catch (error) {
					return {
						content: [{ type: "text", text: JSON.stringify({ connected: false, error: databaseError(error) }) }],
						details: { connected: false },
					};
				}
			},
		}),
		defineTool({
			name: "list_industrial_tables",
			label: "读取工业数据库目录",
			description:
				"发现工业数据库的实际表结构。real_data_01至04是模拟数据，real_data是短暂真实采集数据。先读取目录，再按实际列查询。失败时明确说明未取得数据，不重复重试或伪造字段。",
			parameters: Type.Object({}),
			async execute(_id, _params, signal) {
				signal?.throwIfAborted();
				if (remaining-- <= 0) throw new Error("本轮数据库查询次数已达到上限。");
				const result = await getDatabaseCatalog();
				result.tables = result.tables.filter((table) => table.schema === "dcma");
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			},
		}),
		defineTool({
			name: "read_industrial_rows",
			label: "读取工业设备数据",
			description:
				"只读查询实际工业表，支持设备字段等值筛选与时间范围筛选；只能使用目录中的库、表和列。默认20行，最多200行。必须注明数据来源、模拟/真实采集、返回窗口和单位不明等限制。",
			parameters: Type.Object({
				schema: Type.String({ maxLength: 64 }),
				table: Type.String({ maxLength: 64 }),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
				filters: Type.Optional(
					Type.Array(
						Type.Object({
							column: Type.String({ maxLength: 64 }),
							operator: Type.Union([Type.Literal("="), Type.Literal(">="), Type.Literal("<=")]),
							value: Type.Union([Type.String({ maxLength: 256 }), Type.Number()]),
						}),
						{ maxItems: 4 },
					),
				),
			}),
			async execute(_id, params, signal) {
				if (remaining-- <= 0) throw new Error("本轮数据库查询次数已达到上限。");
				try {
					if (params.schema !== "dcma" || !dashboardTables.some((table) => table === params.table))
						throw new Error("无效的数据来源");
					const result = await readDatabaseRows(params, signal);
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: { connected: true } };
				} catch (error) {
					const message = databaseError(error);
					return {
						content: [{ type: "text", text: JSON.stringify({ connected: false, error: message }) }],
						details: { connected: false },
					};
				}
			},
		}),
	];
}
