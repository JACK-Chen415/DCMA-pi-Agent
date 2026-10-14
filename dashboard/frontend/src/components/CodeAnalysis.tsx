import { useState } from "react";
import { fieldLabels, type CodeEvent, type DashboardRecord, type DashboardTable } from "../database-types.ts";
import { codeClassName, displayRawField, displayTime } from "../dashboard-view.ts";
import { CodeEventHistory } from "./CodeEventHistory.tsx";

const abnormalFields = ["fault_code", "alarm_code"] as const;
const recordFields = ["device_name", "inverter_name", "fault_code", "alarm_code", "control_word", "status_word"] as const;

export function CodeAnalysis({ table, records, loading, truncated, onViewEvent }: { table: DashboardTable; records: DashboardRecord[]; loading: boolean; truncated: boolean; onViewEvent: (event: CodeEvent) => void }) {
	const [kind, setKind] = useState("all");
	const [query, setQuery] = useState("");
	const selectedFields = kind === "fault_code" || kind === "alarm_code" ? [kind] as const : abnormalFields;
	const filtered = records.filter((record) =>
		(kind === "all" || selectedFields.some((field) => codeClassName(field, record.raw[field]))) &&
		(!query.trim() || selectedFields.some((field) => record.raw[field] !== null && String(record.raw[field]).toLocaleUpperCase().includes(query.trim().toLocaleUpperCase()))));
	const reset = () => { setKind("all"); setQuery(""); };
	return <>
		<CodeEventHistory table={table} onViewEvent={onViewEvent} />
		<section className="panel-card" aria-label="代码采样记录">
			<div className="section-heading"><h2>代码采样记录</h2><span className="group-count">{filtered.length} / {records.length} 条</span></div>
			<div className="code-filters"><label>记录类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">全部采样</option><option value="abnormal">异常采样</option><option value="fault_code">故障采样</option><option value="alarm_code">报警采样</option></select></label><label>查询代码<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入故障码或报警码" /></label><button className="code-reset" onClick={reset} disabled={kind === "all" && !query}>重置筛选</button></div>
			<div className="table-scroll code-table"><table><thead><tr><th>采集时间（北京时间）</th><th>记录编号</th>{recordFields.map((field) => <th key={field}>{fieldLabels[field]}</th>)}</tr></thead><tbody>{filtered.map((record) => <tr key={record.id}><td>{displayTime(record.acquiredAt, false, true)}</td><td>{record.id}</td>{recordFields.map((field) => <td key={field} className={codeClassName(field, record.raw[field])}>{displayRawField(field, record.raw[field])}</td>)}</tr>)}</tbody></table></div>
			{!filtered.length && <p className="empty-state">{loading && !records.length ? "正在读取代码记录…" : !records.length ? "当前采样窗口暂无代码记录" : "暂无符合筛选条件的采样记录"}</p>}
			{truncated && <p className="muted small window-count">响应已截断</p>}
		</section>
	</>;
}
