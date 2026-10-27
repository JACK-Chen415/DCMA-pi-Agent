import { createServer, type ServerResponse } from "node:http";
import { databaseError, getDatabaseCatalog, readDatabaseRows, readDashboard, readCodeHistory, readSampleHistory } from "./database.ts";
import { dashboardTables, type DashboardData, type DashboardTable } from "./dashboard-types.ts";

function json(response: ServerResponse, status: number, value: unknown): void {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

export function createDatabaseServer(decorateDashboard?: (data: DashboardData) => Promise<DashboardData>) {
	return createServer((request, response) => {
		const host = request.headers.host ?? "";
		if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
			json(response, 403, { error: "仅允许本地访问" });
			return;
		}
		if (
			request.headers.origin &&
			![`http://${host}`, "http://127.0.0.1:3000", "http://localhost:3000"].includes(request.headers.origin)
		) {
			json(response, 403, { error: "拒绝跨域请求" });
			return;
		}
		const path = new URL(request.url ?? "/", `http://${host}`);
		if (!["/api/database/catalog", "/api/database/rows", "/api/database/dashboard", "/api/database/code-history", "/api/database/sample-history"].includes(path.pathname)) {
			json(response, 404, { error: "接口不存在" });
			return;
		}
		if (request.method !== "GET") {
			json(response, 405, { error: "数据库接口仅支持读取" });
			return;
		}
		void (async () => {
			if (path.pathname === "/api/database/sample-history") {
				const table = path.searchParams.get("table") ?? "real_data_01";
				const limit = Number(path.searchParams.get("limit") ?? 100), page = Number(path.searchParams.get("page") ?? 1);
				const from = path.searchParams.get("from") ?? "", to = path.searchParams.get("to") ?? "";
				const validDate = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
				if (!dashboardTables.includes(table as DashboardTable) || ![50, 100, 200].includes(limit) || !Number.isInteger(page) || page < 1 || page > 1000 ||
					!validDate(from) || !validDate(to) || from > to || [...path.searchParams.keys()].some((key) => !["table", "limit", "page", "from", "to"].includes(key))) {
					json(response, 400, { error: "请提供有效数据来源、起止时间及页码，每页条数为50、100或200，开始时间不能晚于结束时间。" }); return;
				}
				const controller = new AbortController();
				response.once("close", () => { if (!response.writableEnded) controller.abort(); });
				const data = await readSampleHistory({ table: table as DashboardTable, limit: limit as 50 | 100 | 200, page, from, to }, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
				if (!response.destroyed) json(response, 200, data);
				return;
			}
			if (path.pathname === "/api/database/code-history") {
				const table = path.searchParams.get("table") ?? "real_data_01";
				const page = Number(path.searchParams.get("page") ?? 1);
				const from = path.searchParams.get("from") ?? undefined, to = path.searchParams.get("to") ?? undefined;
				const validDate = (value: string | undefined) => !value || (Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
				if (!dashboardTables.includes(table as DashboardTable) || !Number.isInteger(page) || page < 1 || page > 1000 || !validDate(from) || !validDate(to) || (from && to && from > to) || [...path.searchParams.keys()].some((key) => !["table", "page", "from", "to"].includes(key))) {
					json(response, 400, { error: "请提供有效数据来源、页码和起止时间，开始时间不能晚于结束时间。" }); return;
				}
				const controller = new AbortController();
				response.once("close", () => { if (!response.writableEnded) controller.abort(); });
				const data = await readCodeHistory({ table: table as DashboardTable, page, from, to }, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
				if (!response.destroyed) json(response, 200, data);
				return;
			}
			if (path.pathname === "/api/database/dashboard") {
				const table = path.searchParams.get("table") ?? "real_data_01";
				const limit = Number(path.searchParams.get("limit") ?? 100);
				if (!dashboardTables.includes(table as DashboardTable) || ![50, 100, 200].includes(limit) ||
					[...path.searchParams.keys()].some((key) => !["table", "limit"].includes(key))) {
					json(response, 400, { error: "仅支持五张已确认的数据表，采样条数必须为 50、100 或 200。" });
					return;
				}
				const controller = new AbortController();
				response.once("close", () => { if (!response.writableEnded) controller.abort(); });
				const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
				const data = await readDashboard(table as DashboardTable, limit as 50 | 100 | 200, signal);
				const decorated = decorateDashboard ? await decorateDashboard(data) : data;
				if (!response.destroyed) json(response, 200, decorated);
				return;
			}
			if (path.pathname === "/api/database/catalog") {
				json(response, 200, await getDatabaseCatalog(path.searchParams.has("refresh")));
				return;
			}
			const schema = path.searchParams.get("schema") ?? "";
			const table = path.searchParams.get("table") ?? "";
			const limit = Number(path.searchParams.get("limit") ?? 20);
			if (!schema || schema.length > 64 || !table || table.length > 64 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
				json(response, 400, { error: "请提供有效库名、表名与 1 至 200 的行数。" });
				return;
			}
			json(response, 200, await readDatabaseRows({ schema, table, limit }));
		})().catch((error: unknown) => { if (!response.destroyed) json(response, 503, { error: databaseError(error) }); });
	});
}
