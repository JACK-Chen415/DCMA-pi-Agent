import {
	fieldLabels, numericFields, type DashboardData, type DashboardRecord, type DashboardTable, type NumericField, type RawRecord,
} from "./dashboard-types.ts";

// Datetime text has no timezone in MySQL. The agreed provisional interpretation is UTC+08:00.
export function parseCollectionTime(value: unknown): string | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const text = String(value).trim();
	if (/^\d{13}$/.test(text)) {
		const date = new Date(Number(text));
		return Number.isFinite(date.getTime()) ? date.toISOString() : null;
	}
	const parts = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(text);
	if (!parts) return null;
	const [, year, month, day, hour, minute, second, fraction = ""] = parts;
	const utc = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0")}Z`);
	if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 19) !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) return null;
	return new Date(utc.getTime() - 8 * 3600000).toISOString();
}

export function finiteNumber(value: unknown): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function normalizeRecord(row: Record<string, unknown>): DashboardRecord {
	const raw = Object.fromEntries(Object.keys(fieldLabels).map((field) => {
		const value = row[field];
		return [field, value == null ? null : typeof value === "number" && Number.isFinite(value) ? value : String(value)];
	})) as RawRecord;
	return {
		id: String(row.id ?? ""), acquiredAt: parseCollectionTime(row.timestamp), ingestedAt: parseCollectionTime(row.create_time), raw,
		values: Object.fromEntries(numericFields.map((field) => [field, finiteNumber(row[field])])) as Record<NumericField, number | null>,
	};
}

// This expression deliberately avoids server/session timezone-dependent UNIX_TIMESTAMP.
// Same input formats and UTC+08:00 interpretation as parseCollectionTime.
export const collectionTimeSql = `CASE
	WHEN TRIM(\`timestamp\`) REGEXP '^[0-9]{13}$' THEN CAST(TRIM(\`timestamp\`) AS UNSIGNED)
	WHEN TRIM(\`timestamp\`) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?$'
	THEN TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00',
		STR_TO_DATE(REPLACE(TRIM(\`timestamp\`), 'T', ' '),
			IF(INSTR(\`timestamp\`, '.') > 0, '%Y-%m-%d %H:%i:%s.%f', '%Y-%m-%d %H:%i:%s'))) / 1000 - 28800000
	ELSE NULL END`;

export function makeDashboardData(
	table: DashboardTable, limit: 50 | 100 | 200, sources: DashboardData["sources"], rows: Record<string, unknown>[], hasMore: boolean,
	maxBytes = 512000,
): DashboardData {
	const records = rows.map(normalizeRecord);
	const invalidTimes = records.filter((record) => !record.acquiredAt).length;
	const latest = records[0] ?? null;
	const selected = sources.find((source) => source.table === table);
	if (selected) selected.latest = latest;
	const data: DashboardData = {
		schema: "dcma", table, limit, queriedAt: new Date().toISOString(), sources, latest, records,
		samples: records.filter((record): record is DashboardRecord & { acquiredAt: string } => record.acquiredAt !== null)
			.map(({ id, acquiredAt, values }) => ({ id, acquiredAt, values })).reverse(),
		returned: records.length, hasMore, truncated: false, warnings: [],
	};
	if (invalidTimes) data.warnings.push(`${invalidTimes} 条记录的采集时间无法解析，未进入时间曲线；原值保留在采样明细。`);
	data.warnings.push(...sources.filter((source) => source.message).map((source) => `${source.table}：${source.message}`));
	while (Buffer.byteLength(JSON.stringify(data)) > maxBytes && data.records.length > 1) {
		const removed = data.records.pop()!;
		if (removed.acquiredAt) data.samples.shift();
		data.truncated = true;
		data.hasMore = true;
	}
	data.returned = data.records.length;
	if (data.truncated) data.warnings.push("响应大小达到上限，较早采样已截断；最新读数保持不变。");
	if (Buffer.byteLength(JSON.stringify(data)) > maxBytes) throw new Error("DASHBOARD_RESULT_TOO_LARGE");
	return data;
}
