import { useMemo } from "react";
import type { DashboardRecord, DashboardTable } from "../database-types.ts";
import { recentCodeHistory } from "../code-analysis.ts";
import { codeClassName, displayTime } from "../dashboard-view.ts";

export function RecentEvents({ table, records, loading }: { table: DashboardTable; records: DashboardRecord[]; loading: boolean }) {
	const history = useMemo(() => recentCodeHistory(table, records), [table, records]);
	return <section className="panel-card" aria-label="近期事件列表">
		<div className="section-heading"><h2>事件列表</h2><span className="group-count">当前 {records.length} 条采样 · {history.total} 个事件</span></div>
		<div className="table-scroll recent-event-table"><table><thead><tr><th>日期（北京时间）</th><th>时间</th><th>事件</th><th>事件值</th></tr></thead><tbody>{history.events.map((event) => {
			const [date, time] = displayTime(event.startedAt, false, true).split(" ");
			return <tr key={event.id}><td>{date}</td><td>{time}{event.startUncertain && <span className="event-time-note">窗口内首次观察</span>}</td><td>{event.field === "fault_code" ? "故障" : "报警"}</td><td className={codeClassName(event.field, event.code)}>{event.code}</td></tr>;
		})}</tbody></table></div>
		{!history.events.length && <p className="empty-state">{loading && !records.length ? "正在读取事件…" : !records.length ? "当前采样窗口暂无记录" : "当前采样窗口未观察到故障或报警事件"}</p>}
		{history.total > history.events.length && <p className="muted small window-count">显示最新 {history.events.length} 个事件。</p>}
		<div className="recent-events-footer"><span className="muted small">按当前采样窗口合并连续相同代码，以首次观察时间显示。</span><a className="text-link" href="#codes">查看历史故障与报警 →</a></div>
	</section>;
}
