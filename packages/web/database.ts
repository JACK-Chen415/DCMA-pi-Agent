import { defineTool } from "@earendil-works/pi-coding-agent";
import { createPool, escapeId, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { Type } from "typebox";
import type { DatabaseCatalog, DatabaseRows, DatabaseTable } from "./src/database-types.ts";

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
			AND (TABLE_NAME IN (${placeholders}) OR TABLE_SCHEMA IN (${placeholders}))
			${schema ? "AND TABLE_SCHEMA = ?" : ""}
			ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
				timeout: 5000,
			},
			[...sources, ...sources, ...(schema ? [schema] : [])],
		);
		const tables = new Map<string, DatabaseTable>();
		for (const row of rows) {
			const schemaName = String(row.TABLE_SCHEMA);
			const name = String(row.TABLE_NAME);
			const key = `${schemaName}\0${name}`;
			const source = sources.includes(name) ? name : schemaName;
			const kind = source === "real_data" ? "acquired" : "simulation";
			const table = tables.get(key) ?? {
				schema: schemaName,
				name,
				kind,
				label: kind === "acquired" ? "短暂真实采集数据" : "实时模拟数据",
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

export function createDatabaseTools() {
	let remaining = 8;
	return [
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
export async function closeDatabase(): Promise<void> {
	await pool?.end();
	pool = undefined;
}
