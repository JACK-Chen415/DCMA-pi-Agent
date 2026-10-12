import { createCodeHistory } from "../../database/code-events.ts";
import type { DashboardRecord, DashboardTable } from "./database-types.ts";

export function recentCodeHistory(table: DashboardTable, records: DashboardRecord[]) {
	const history = createCodeHistory({ table, page: 1 });
	const ordered = [...records].sort((a, b) => (a.acquiredAt ?? "").localeCompare(b.acquiredAt ?? "") || a.id.localeCompare(b.id, undefined, { numeric: true }));
	for (const record of ordered) history.add({ ...record.raw, id: record.id, timestamp: record.acquiredAt ? String(Date.parse(record.acquiredAt)) : null });
	return history.finish();
}

export function displaySamplingSpan(milliseconds: number): string {
	const parts: string[] = [];
	for (const [unit, size] of [["天", 86400000], ["小时", 3600000], ["分", 60000]] as const) {
		const value = Math.floor(milliseconds / size);
		if (value) parts.push(`${value} ${unit}`);
		milliseconds %= size;
	}
	if (milliseconds || !parts.length) parts.push(`${milliseconds / 1000} 秒`);
	return parts.join(" ");
}
