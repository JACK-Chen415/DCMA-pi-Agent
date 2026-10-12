import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createDatabaseServer } from "../server.ts";
import type { DatabaseCatalog } from "../types.ts";
import { finiteNumber, makeDashboardData, normalizeRecord, parseCollectionTime } from "../dashboard-data.ts";
import { dashboardTables, type DashboardSource } from "../dashboard-types.ts";

test("只读接口在无凭据时明确失败，并拒绝写入、无效参数及跨域访问", async (context) => {
	// 在独立测试进程中清除连接配置，避免访问真实 MySQL。
	for (const key of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"]) delete process.env[key];
	const server = createDatabaseServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	context.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const catalog = await fetch(`${base}/api/database/catalog`);
	assert.equal(catalog.status, 200);
	const body = (await catalog.json()) as DatabaseCatalog;
	assert.equal(body.configured, false);
	assert.equal(body.connected, false);
	assert.deepEqual(body.tables, []);
	assert.match(body.message, /尚未配置/);
	assert.equal((await fetch(`${base}/api/database/catalog`, { method: "POST" })).status, 405);
	assert.equal((await fetch(`${base}/api/database/rows?schema=example&table=real_data&limit=201`)).status, 400);
	assert.equal((await fetch(`${base}/api/database/rows`)).status, 400);
	assert.equal((await fetch(`${base}/api/database/rows?schema=example&table=real_data`)).status, 503);
	assert.equal((await fetch(`${base}/api/database/dashboard?table=real_data_01&limit=100`)).status, 503);
	assert.equal((await fetch(`${base}/api/database/dashboard`, { method: "POST" })).status, 405);
	assert.equal((await fetch(`${base}/api/database/code-history`, { method: "POST" })).status, 405);
	assert.equal((await fetch(`${base}/api/database/sample-history`, { method: "POST" })).status, 405);
	const sampleRange = "from=2026-10-10T04:00:00.000Z&to=2026-10-10T05:00:00.000Z";
	assert.equal((await fetch(`${base}/api/database/sample-history?${sampleRange}`)).status, 503);
	assert.equal((await fetch(`${base}/api/database/sample-history`)).status, 400);
	for (const query of ["table=other", "limit=20", "page=0", "page=1.5", "page=1001", "from=invalid", "from=2026-02-30T00:00:00.000Z", "to=2026-10-09T00:00:00.000Z", "schema=other"]) assert.equal((await fetch(`${base}/api/database/sample-history?${query}&${sampleRange}`)).status, 400);
	assert.equal((await fetch(`${base}/api/database/code-history?table=real_data_01`)).status, 503);
	for (const query of ["table=other", "page=0", "page=1.5", "page=1001", "from=invalid", "from=2026-02-30T00:00:00.000Z", "limit=100", "from=2026-10-11T00:00:00.000Z&to=2026-10-10T00:00:00.000Z"]) assert.equal((await fetch(`${base}/api/database/code-history?${query}`)).status, 400);
	for (const query of ["table=other", "limit=20", "limit=101", "limit=NaN", "schema=other", "table=real_data%60%3BDELETE"]) {
		assert.equal((await fetch(`${base}/api/database/dashboard?${query}`)).status, 400);
	}
	assert.equal((await fetch(`${base}/api/database/catalog`, { headers: { Origin: "https://example.com" } })).status, 403);
	const invalidHostStatus = await new Promise<number>((resolve, reject) => {
		get(`${base}/api/database/catalog`, { headers: { Host: "example.com:3001" } }, (response) => {
			response.resume();
			resolve(response.statusCode ?? 0);
		}).on("error", reject);
	});
	assert.equal(invalidHostStatus, 403);
	assert.equal((await fetch(`${base}/api/database/catalog`, { headers: { Origin: "http://127.0.0.1:3000" } })).status, 200);
	assert.equal((await fetch(`${base}/api/chat`)).status, 404);
});

test("展板时间、数值与结果窗口保留原值，排除无效时间并明确截断", () => {
	assert.equal(parseCollectionTime("2026-01-14 18:27:24.814"), "2026-01-14T10:27:24.814Z");
	assert.equal(parseCollectionTime("1768386444814"), "2026-01-14T10:27:24.814Z");
	assert.equal(parseCollectionTime("2026-10-10T17:11:12"), "2026-10-10T09:11:12.000Z");
	for (const value of [null, "", "2026-02-30 00:00:00", "2026-10-10 25:00:00", "not a time"]) {
		assert.equal(parseCollectionTime(value), null);
	}
	assert.equal(finiteNumber(0), 0);
	assert.equal(finiteNumber("-0.5"), -0.5);
	for (const value of [null, "", " ", "0x10", true, Infinity, "NaN"]) assert.equal(finiteNumber(value), null);
	const row = { id: "9007199254740993", timestamp: "1768386444814", create_time: "2026-08-08 17:10:33",
		device_name: "G120电机1", inverter_name: "G120电机1", speed_actual: 0, torque_actual: -0.2,
		air_intake_temp: -200, fault_code: "0", system_run_time: "0000:00:00" };
	const normalized = normalizeRecord(row);
	assert.equal(normalized.id, row.id);
	assert.equal(normalized.values.speed_actual, 0);
	assert.equal(normalized.values.torque_actual, -0.2);
	assert.equal(normalized.values.current_actual, null);
	assert.equal(normalized.raw.air_intake_temp, -200);
	assert.equal(normalized.raw.system_run_time, "0000:00:00");
	assert.notEqual(normalized.ingestedAt, normalized.acquiredAt);
	const sources = (): DashboardSource[] => dashboardTables.map((table) => ({
		table, deviceIndex: table === "real_data" ? 1 : Number(table.slice(-2)), kind: table === "real_data" ? "acquired" : "simulation",
		available: true, latest: null, message: "",
	}));
	const data = makeDashboardData("real_data_01", 50, sources(), [row, { ...row, id: "2" }, { ...row, id: "1", timestamp: "invalid" }], false);
	assert.deepEqual(data.samples.map((sample) => sample.id), ["2", row.id]);
	assert.equal(data.records.length, 3);
	assert.equal(data.latest, data.sources[0].latest);
	assert.match(data.warnings[0], /1 条记录/);
	const empty = makeDashboardData("real_data", 50, sources(), [], false);
	assert.equal(empty.latest, null);
	assert.deepEqual(empty.samples, []);
	const large = makeDashboardData("real_data_01", 100, sources(), Array.from({ length: 100 }, (_, index) => ({ ...row, id: String(100 - index) })), true, 15000);
	assert.equal(large.truncated, true);
	assert.equal(large.hasMore, true);
	assert.equal(large.latest?.id, "100");
	assert.ok(large.returned < 100);
	assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 15000);
	assert.throws(() => makeDashboardData("real_data_01", 50, sources(), [{ ...row, system_run_time: "x".repeat(600000) }], false), /DASHBOARD_RESULT_TOO_LARGE/);
});
