import { createPool, escapeId, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type { Connection as CoreConnection } from "mysql2";
import { createCodeHistory, type CodeHistoryOptions } from "./code-events.ts";
import type { DatabaseCatalog, DatabaseRows, DatabaseTable } from "./types.ts";
import { collectionTimeSql, makeDashboardData, normalizeRecord } from "./dashboard-data.ts";
import { dashboardTables, type DashboardData, type DashboardHistory, type DashboardRange, type DashboardSource, type DashboardTable } from "./dashboard-types.ts";

const sources = ["real_data", "real_data_01", "real_data_02", "real_data_03", "real_data_04"];
let pool: Pool | undefined;
let catalogPromise: Promise<DatabaseTable[]> | undefined;
let catalogExpiry = 0;

export function databaseConfigured(): boolean {
	return !!(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_PASSWORD);
}
function getPool(): Pool {
	if (!databaseConfigured()) throw new Error("MYSQL_NOT_CONFIGURED");
	const port = Number(process.env.MYSQL_PORT || 3306);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MYSQL_INVALID_PORT");
	pool ??= createPool({
		host: process.env.MYSQL_HOST,
		port,
		user: process.env.MYSQL_USER,
		password: process.env.MYSQL_PASSWORD,
		connectTimeout: 5000,
		connectionLimit: 2,
		maxIdle: 2,
		idleTimeout: 30000,
		queueLimit: 4,
		waitForConnections: true,
		dateStrings: true,
		supportBigNumbers: true,
		bigNumberStrings: true,
		multipleStatements: false,
		charset: "utf8mb4",
	});
	return pool;
}

// The account may have broad permissions; every operation runs in a read-only transaction.
async function readOnly<T>(operation: (connection: PoolConnection) => Promise<T>, signal?: AbortSignal): Promise<T> {
	signal?.throwIfAborted();
	const connection = await getPool().getConnection();
	const abort = () => connection.destroy();
	signal?.addEventListener("abort", abort, { once: true });
	try {
		signal?.throwIfAborted();
		await connection.query({ sql: "START TRANSACTION READ ONLY", timeout: 5000 });
		const value = await operation(connection);
		await connection.query({ sql: "COMMIT", timeout: 5000 });
		return value;
	} catch (error) {
		connection.destroy();
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
		connection.release();
	}
}

export function databaseError(error: unknown): string {
	const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
	if (code === "ER_ACCESS_DENIED_ERROR") return "MySQL 拒绝登录，请核对账号权限和本机连接来源。";
	if (code === "ECONNREFUSED") return "MySQL 拒绝连接，请检查服务是否启动及端口是否正确。";
	if (code === "ENOTFOUND") return "MySQL 地址无法解析。";
	if (error instanceof Error && error.message === "MYSQL_NOT_CONFIGURED") return "尚未配置 MySQL 后端连接。";
	if (error instanceof Error && error.message === "MYSQL_INVALID_PORT") return "MySQL 端口配置无效。";
	if (error instanceof Error && error.message === "DASHBOARD_RESULT_TOO_LARGE") return "单条记录超过展板结果大小限制，请通过原始记录预览核对数据。";
	if (error instanceof Error && error.message === "CODE_HISTORY_UNAVAILABLE") return "当前来源不存在或缺少故障历史所需字段。";
	if (error instanceof Error && error.message === "CODE_HISTORY_MIXED_DEVICES") return "当前来源包含多个设备或变频器，已停止混合展示故障历史。";
	if (error instanceof Error && error.message === "SAMPLE_HISTORY_UNAVAILABLE") return "当前来源不存在或缺少采样查询所需字段。";
	if (error instanceof Error && error.message === "SAMPLE_HISTORY_MIXED_DEVICES") return "当前来源包含多个设备或变频器，已停止混合展示采样记录。";
	if (error instanceof Error && error.message === "SAMPLE_HISTORY_TOO_MANY") return "所选时段超过1000页，请缩小时间范围或增加每页条数。";
	if (error instanceof Error && error.message === "SAMPLE_HISTORY_TOO_LARGE") return "当前页数据超过大小限制，请减少每页条数或缩小时间范围。";
	return "MySQL 未连接或查询失败；请确认校园网/VPN、3306 端口及数据库权限。没有返回可用于分析的数据。";
}

async function discoverTables(): Promise<DatabaseTable[]> {
	return readOnly(async (connection) => {
		const placeholders = sources.map(() => "?").join(",");
		const schema = process.env.MYSQL_DATABASE?.trim();
		const [rows] = await connection.execute<RowDataPacket[]>(
			{
				sql: `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY, COLUMN_COMMENT
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')
			AND TABLE_NAME IN (${placeholders})
			${schema ? "AND TABLE_SCHEMA = ?" : ""}
			ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
				timeout: 5000,
			},
			[...sources, ...(schema ? [schema] : [])],
		);
		const tables = new Map<string, DatabaseTable>();
		for (const row of rows) {
			const schemaName = String(row.TABLE_SCHEMA);
			const name = String(row.TABLE_NAME);
			const key = `${schemaName}\0${name}`;
			const source = name;
			const kind = source === "real_data" ? "acquired" : "simulation";
			const table = tables.get(key) ?? {
				schema: schemaName,
				name,
				kind,
				label: kind === "acquired" ? "短暂真实采集数据" : "模拟数据",
				columns: [],
			};
			table.columns.push({
				name: String(row.COLUMN_NAME),
				type: String(row.DATA_TYPE),
				primaryKey: row.COLUMN_KEY === "PRI",
				comment: String(row.COLUMN_COMMENT || ""),
			});
			tables.set(key, table);
		}
		return [...tables.values()];
	});
}

export async function listDatabaseTables(refresh = false): Promise<DatabaseTable[]> {
	if (refresh || Date.now() >= catalogExpiry) catalogPromise = undefined;
	if (!catalogPromise) {
		catalogExpiry = Date.now() + 60000;
		catalogPromise = discoverTables().catch((error: unknown) => {
			catalogPromise = undefined;
			throw error;
		});
	}
	return catalogPromise;
}

export async function getDatabaseCatalog(refresh = false): Promise<DatabaseCatalog> {
	try {
		const tables = await listDatabaseTables(refresh);
		return {
			configured: true,
			connected: true,
			checkedAt: new Date().toISOString(),
			tables,
			message: tables.length
				? `MySQL 已连接，找到 ${tables.length} 张授权范围内的表。`
				: "MySQL 已连接，未找到指定的数据表/数据库。请核对库名和权限。",
		};
	} catch (error) {
		return {
			configured: databaseConfigured(),
			connected: false,
			checkedAt: new Date().toISOString(),
			tables: [],
			message: databaseError(error),
		};
	}
}

export interface DatabaseReadOptions {
	schema: string;
	table: string;
	limit?: number;
	filters?: { column: string; operator: "=" | ">=" | "<="; value: string | number }[];
}
export async function readDatabaseRows(options: DatabaseReadOptions, signal?: AbortSignal): Promise<DatabaseRows> {
	const table = (await listDatabaseTables()).find(
		(item) => item.schema === options.schema && item.name === options.table,
	);
	if (!table) throw new Error("只能读取目录中列出的 real_data 与 real_data_01 至 real_data_04 数据源。");
	const limit = options.limit ?? 20;
	if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("每次读取 1 至 200 行。");
	const filters = options.filters ?? [];
	if (
		filters.length > 4 ||
		filters.some(
			(filter) =>
				!table.columns.some((column) => column.name === filter.column) ||
				!["=", ">=", "<="].includes(filter.operator) ||
				(typeof filter.value !== "string" && typeof filter.value !== "number") ||
				(typeof filter.value === "number" && !Number.isFinite(filter.value)) ||
				(typeof filter.value === "string" && filter.value.length > 256),
		)
	)
		throw new Error("筛选条件无效，请使用实际字段，每次最多 4 个条件。");
	const orderBy =
		table.columns.find((column) => ["datetime", "timestamp"].includes(column.type))?.name ??
		table.columns.find((column) => column.primaryKey)?.name ??
		null;
	return readOnly(async (connection) => {
		const [rows] = await connection.execute<RowDataPacket[]>(
			{
				sql: `SELECT * FROM ${escapeId(table.schema)}.${escapeId(table.name)}
			${filters.length ? `WHERE ${filters.map((filter) => `${escapeId(filter.column)} ${filter.operator} ?`).join(" AND ")}` : ""}
			${orderBy ? `ORDER BY ${escapeId(orderBy)} DESC` : ""} LIMIT ?`,
				timeout: 5000,
			},
			[...filters.map((filter) => filter.value), limit + 1],
		);
		const candidates = rows
			.slice(0, limit)
			.map((row) =>
				Object.fromEntries(
					Object.entries(row).map(([key, value]: [string, unknown]) => [
						key,
						Buffer.isBuffer(value)
							? `[二进制数据 ${value.length} 字节]`
							: typeof value === "string" && value.length > 2000
								? `${value.slice(0, 2000)}…[已截断]`
								: value,
					]),
				),
			);
		const selected: Record<string, unknown>[] = [];
		let bytes = 0;
		for (const row of candidates) {
			const size = Buffer.byteLength(JSON.stringify(row));
			if (bytes + size > 64000) break;
			selected.push(row);
			bytes += size;
		}
		return {
			table,
			queriedAt: new Date().toISOString(),
			rows: selected,
			returned: selected.length,
			hasMore: rows.length > selected.length,
			orderBy,
			note: `${orderBy ? `按 ${orderBy} 降序返回` : "未找到时间或主键字段，行顺序不确定"}；结果最多200行/64KB，长文本或二进制会截断。仅代表本次返回的有界数据窗口，不是全库统计。MySQL 日期字符串未附带时区，字段单位与设备关联需根据数据库说明确认。`,
		};
	}, signal);
}

export async function closeDatabase(): Promise<void> {
	await pool?.end();
	pool = undefined;
}

export async function readDashboard(table: DashboardTable, limit: 50 | 100 | 200, signal?: AbortSignal): Promise<DashboardData> {
	if (!dashboardTables.includes(table) || ![50, 100, 200].includes(limit)) throw new Error("无效的展板参数");
	const catalog = (await listDatabaseTables()).filter((item) => item.schema === "dcma");
	return readOnly(async (connection) => {
		const summaries: DashboardSource[] = [];
		let selectedRows: Record<string, unknown>[] = [];
		let hasMore = false;
		for (const name of dashboardTables) {
			signal?.throwIfAborted();
			const metadata = catalog.find((item) => item.name === name);
			const source: DashboardSource = {
				table: name, deviceIndex: name === "real_data" ? 1 : Number(name.slice(-2)),
				kind: name === "real_data" ? "acquired" : "simulation", available: !!metadata, latest: null, message: "",
			};
			summaries.push(source);
			if (!metadata) { source.message = "数据表不存在或不可读取"; continue; }
			if (["id", "timestamp", "device_name", "inverter_name"].some((field) => !metadata.columns.some((column) => column.name === field))) {
				source.message = "缺少记录编号、采集时间或设备标识字段"; continue;
			}
			const qualified = `${escapeId("dcma")}.${escapeId(name)}`;
			const [identities] = await connection.query<RowDataPacket[]>({
				sql: `SELECT DISTINCT device_name, inverter_name FROM ${qualified}
				WHERE device_name IS NOT NULL AND TRIM(device_name) <> '' AND inverter_name IS NOT NULL AND TRIM(inverter_name) <> '' LIMIT 2`, timeout: 5000,
			});
			if (identities.length > 1) {
				source.message = "同一来源包含多个设备或变频器，已停止混合展示，请核对表内设备关系"; continue;
			}
			if (!identities.length) { source.message = "暂无采样记录"; continue; }
			const [rows] = await connection.execute<RowDataPacket[]>({
				sql: `SELECT *, ${collectionTimeSql} AS __collection_ms FROM ${qualified}
				WHERE device_name <=> ? AND inverter_name <=> ? ORDER BY __collection_ms DESC, id DESC LIMIT ?`, timeout: 5000,
			}, [identities[0].device_name, identities[0].inverter_name, name === table ? limit + 1 : 1]);
			source.latest = rows[0] ? normalizeRecord(rows[0]) : null;
			if (!source.latest?.acquiredAt) source.message = "采集时间无法解析，保留原始记录，不进入时间曲线";
			if (name === table) { selectedRows = rows.slice(0, limit); hasMore = rows.length > limit; }
		}
		return makeDashboardData(table, limit, summaries, selectedRows, hasMore);
	}, signal);
}

export async function readCodeHistory(options: CodeHistoryOptions, signal?: AbortSignal) {
	if (!dashboardTables.includes(options.table)) throw new Error("无效的展板参数");
	const metadata = (await listDatabaseTables()).find((item) => item.schema === "dcma" && item.name === options.table);
	if (!metadata || ["id", "timestamp", "device_name", "inverter_name", "fault_code", "alarm_code"].some((field) => !metadata.columns.some((column) => column.name === field))) throw new Error("CODE_HISTORY_UNAVAILABLE");
	return readOnly(async (connection) => {
		const qualified = `${escapeId("dcma")}.${escapeId(options.table)}`;
		const [identities] = await connection.query<RowDataPacket[]>({ sql: `SELECT DISTINCT device_name, inverter_name FROM ${qualified}
			WHERE device_name IS NOT NULL AND TRIM(device_name) <> '' AND inverter_name IS NOT NULL AND TRIM(inverter_name) <> '' LIMIT 2`, timeout: 5000 });
		if (identities.length > 1) throw new Error("CODE_HISTORY_MIXED_DEVICES");
		const history = createCodeHistory(options);
		if (!identities.length) return history.finish();
		const stream = (connection.connection as unknown as CoreConnection).query({ sql: `SELECT id, timestamp, fault_code, alarm_code, ${collectionTimeSql} AS __collection_ms FROM ${qualified}
			WHERE device_name <=> ? AND inverter_name <=> ? ORDER BY __collection_ms ASC, id ASC`, timeout: 55000 }, [identities[0].device_name, identities[0].inverter_name]).stream({ highWaterMark: 1000 });
		const abortStream = () => stream.destroy(new Error("故障历史查询已取消"));
		signal?.addEventListener("abort", abortStream, { once: true });
		try {
			signal?.throwIfAborted();
			for await (const row of stream) { signal?.throwIfAborted(); history.add(row as Record<string, unknown>); }
		} finally { signal?.removeEventListener("abort", abortStream); }
		return history.finish();
	}, signal);
}

export async function readSampleHistory(options: DashboardRange & { table: DashboardTable; limit: 50 | 100 | 200; page: number }, signal?: AbortSignal): Promise<DashboardHistory> {
	const { table, limit, page, from, to } = options;
	if (!dashboardTables.includes(table) || ![50, 100, 200].includes(limit) || !Number.isInteger(page) || page < 1 || page > 1000 ||
		!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || new Date(from).toISOString() !== from || new Date(to).toISOString() !== to || from > to) throw new Error("无效的时段查询参数");
	const metadata = (await listDatabaseTables()).find((item) => item.schema === "dcma" && item.name === table);
	if (!metadata || ["id", "timestamp", "device_name", "inverter_name"].some((field) => !metadata.columns.some((column) => column.name === field))) throw new Error("SAMPLE_HISTORY_UNAVAILABLE");
	return readOnly(async (connection) => {
		const qualified = `${escapeId("dcma")}.${escapeId(table)}`;
		const [identities] = await connection.query<RowDataPacket[]>({ sql: `SELECT DISTINCT device_name, inverter_name FROM ${qualified}
			WHERE device_name IS NOT NULL AND TRIM(device_name) <> '' AND inverter_name IS NOT NULL AND TRIM(inverter_name) <> '' LIMIT 2`, timeout: 5000 });
		if (identities.length > 1) throw new Error("SAMPLE_HISTORY_MIXED_DEVICES");
		const sources: DashboardSource[] = [{ table, deviceIndex: table === "real_data" ? 1 : Number(table.slice(-2)), kind: table === "real_data" ? "acquired" : "simulation", available: true, latest: null, message: "" }];
		let rows: RowDataPacket[] = [], total = 0;
		if (identities.length) {
			const parameters = [identities[0].device_name, identities[0].inverter_name, Date.parse(from), Date.parse(to)];
			const selected = `(SELECT *, ${collectionTimeSql} AS __collection_ms FROM ${qualified} WHERE device_name <=> ? AND inverter_name <=> ?) AS history_rows WHERE __collection_ms BETWEEN ? AND ?`;
			const [counts] = await connection.execute<RowDataPacket[]>({ sql: `SELECT COUNT(*) AS total FROM ${selected}`, timeout: 55000 }, parameters);
			total = Number(counts[0].total);
			if (!Number.isSafeInteger(total) || total > limit * 1000) throw new Error("SAMPLE_HISTORY_TOO_MANY");
			[rows] = await connection.execute<RowDataPacket[]>({ sql: `SELECT * FROM ${selected} ORDER BY __collection_ms DESC, id DESC LIMIT ? OFFSET ?`, timeout: 55000 }, [...parameters, limit, (page - 1) * limit]);
		}
		const data: DashboardHistory = { ...makeDashboardData(table, limit, sources, rows, page * limit < total), from, to, page, total };
		// Never skip records between pages when a response reaches the size limit.
		if (data.truncated || Buffer.byteLength(JSON.stringify(data)) > 512000) throw new Error("SAMPLE_HISTORY_TOO_LARGE");
		return data;
	}, signal);
}
