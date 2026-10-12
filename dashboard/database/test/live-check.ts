import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createConnection } from "mysql2/promise";
import { collectionTimeSql, parseCollectionTime } from "../dashboard-data.ts";
import { closeDatabase, readDashboard } from "../database.ts";

// 显式执行的真实数据库只读验收；不由 npm test 自动执行，不打印连接参数。
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
const connection = await createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, connectTimeout: 5000 });
try {
	await connection.query("START TRANSACTION READ ONLY");
	for (const value of ["2026-02-30 00:00:00", "2026-00-10 00:00:00", "2026-13-10 00:00:00", "2026-10-10 25:00:00", "2026-10-10 24:00:00", "2026-10-10 12:61:00", "2026-10-10T17:11:12", "2026-01-14 18:27:24.814", "1768386444814", "invalid", "", null]) {
		const [rows] = await connection.execute(`SELECT ${collectionTimeSql} AS ms FROM (SELECT ? AS timestamp) AS inputs`, [value]);
		const ms = (rows as { ms: string | number | null }[])[0].ms;
		const actual = ms === null ? null : new Date(Number(ms)).toISOString();
		assert.equal(actual, parseCollectionTime(value), `SQL/JS采集时间不一致: ${value}`);
	}
	await connection.query("COMMIT");
	console.log("PASS: SQL与JS对有效时间、非法日期、24点、空值一致。");
} finally { await connection.end(); }
try {
	const signal = AbortSignal.abort();
	await assert.rejects(readDashboard("real_data_01", 100, signal));
	const results = await Promise.allSettled([
		readDashboard("real_data_01", 100, AbortSignal.timeout(30)),
		readDashboard("real_data_02", 50),
		readDashboard("real_data", 100),
	]);
	assert.equal(results[0].status, "rejected");
	assert.equal(results[1].status, "fulfilled");
	assert.equal(results[2].status, "fulfilled");
	const data = await readDashboard("real_data_01", 200);
	assert.equal(data.returned, 200);
	assert.equal(data.latest?.id, data.sources.find((source) => source.table === data.table)?.latest?.id);
	assert.ok(data.samples.every((sample, index) => !index || sample.acquiredAt >= data.samples[index - 1].acquiredAt));
	console.log("PASS: 预先取消、查询中取消、并发请求、取消后连接恢复、200条时间升序及摘要一致。");
} finally { await closeDatabase(); }
