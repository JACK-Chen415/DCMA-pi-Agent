import { parseCollectionTime } from "./dashboard-data.ts";
import type { CodeEvent, CodeField, CodeHistory, DashboardTable } from "./dashboard-types.ts";

export interface CodeHistoryOptions { table: DashboardTable; page: number; from?: string; to?: string }
const fields: CodeField[] = ["fault_code", "alarm_code"];

// 按采集时间、id升序接收整个来源的历史；只保存当前事件及本页结果。
export function createCodeHistory(options: CodeHistoryOptions) {
	const result: CodeHistory = { table: options.table, queriedAt: "", page: options.page, pageSize: 50, total: 0, faults: 0, alarms: 0, open: 0, invalidTimes: 0, events: [], codes: [] };
	const active: Partial<Record<CodeField, CodeEvent>> = {};
	const previous: Partial<Record<CodeField, string | null>> = {};
	const codes = new Map<string, CodeHistory["codes"][number]>();
	const retain = options.page * result.pageSize;
	const collect = (event: CodeEvent) => {
		// 取事件与查询区间的交集，保留完整事件时间。
		if ((options.to && event.startedAt > options.to) || (options.from && event.endedAt && event.endedAt < options.from)) return;
		result.total++;
		if (event.field === "fault_code") result.faults++; else result.alarms++;
		if (!event.endedAt) result.open++;
		const key = JSON.stringify([event.field, event.code]);
		const entry = codes.get(key) ?? { field: event.field, code: event.code, count: 0, durationMs: 0 };
		entry.count++;
		entry.durationMs += Math.max(0, Date.parse(event.endedAt ?? event.lastSeenAt) - Date.parse(event.startedAt));
		codes.set(key, entry);
		result.events.push(event);
		result.events.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id, undefined, { numeric: true }));
		if (result.events.length > retain) result.events.length = retain;
	};
	return {
		add(row: Record<string, unknown>) {
			const time = parseCollectionTime(row.timestamp);
			if (!time) {
				result.invalidTimes++;
				for (const event of Object.values(active)) event.hasMissingSamples = true;
				return;
			}
			for (const field of fields) {
				const value = row[field];
				if (value === null || value === undefined || value === "") {
					if (active[field]) active[field]!.hasMissingSamples = true;
					previous[field] = null;
					continue;
				}
				const code = String(value);
				let event = active[field];
				if (event && event.code !== code) {
					event.endedAt = time;
					event.ending = code === "0" ? "zero" : "changed";
					collect(event);
					delete active[field];
					event = undefined;
				}
				if (code !== "0") {
					if (!event) active[field] = event = { id: `${field}/${row.id}`, field, code, startedAt: time, endedAt: null, lastSeenAt: time, samples: 0, ending: null, startUncertain: previous[field] == null, hasMissingSamples: false };
					event.samples++;
					event.lastSeenAt = time;
				}
				previous[field] = code;
			}
		},
		finish() {
			for (const event of Object.values(active)) collect(event);
			result.events = result.events.slice((options.page - 1) * result.pageSize);
			result.codes = [...codes.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
			result.queriedAt = new Date().toISOString();
			return result;
		},
	};
}
