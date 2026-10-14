import { useEffect, useState } from "react";
import { fieldLabels, type CodeEvent, type CodeHistory, type DashboardTable } from "../database-types.ts";
import { displaySamplingSpan } from "../code-analysis.ts";
import { codeClassName, displayTime } from "../dashboard-view.ts";
import { DateTimeInput } from "./DateTimeInput.tsx";

export function CodeEventHistory({ table, onViewEvent }: { table: DashboardTable; onViewEvent: (event: CodeEvent) => void }) {
	const [from, setFrom] = useState(""), [to, setTo] = useState("");
	const [range, setRange] = useState({ from: "", to: "" });
	const [page, setPage] = useState(1), [reload, setReload] = useState(0);
	const [validation, setValidation] = useState("");
	const [state, setState] = useState<{ key: string; data: CodeHistory | null; loading: boolean; error: string }>({ key: "", data: null, loading: true, error: "" });
	const key = `${table}/${range.from}/${range.to}/${page}`;
	useEffect(() => {
		let active = true, busy = false;
		let controller: AbortController | null = null;
		const request = async () => {
			if (!active || busy) return;
			busy = true;
			controller = new AbortController();
			const timeout = setTimeout(() => controller?.abort(), 65000);
			setState((current) => ({ key, data: current.key === key ? current.data : null, loading: true, error: "" }));
			try {
				const parameters = new URLSearchParams({ table, page: String(page) });
				if (range.from) parameters.set("from", range.from);
				if (range.to) parameters.set("to", range.to);
				const response = await fetch(`/api/database/code-history?${parameters}`, { signal: controller.signal });
				const body = await response.json();
				if (!response.ok) throw new Error(body.error || "异常历史查询失败。");
				if (body.table !== table || body.page !== page) throw new Error("异常历史来源与当前选择不一致。");
				if (active) setState({ key, data: body as CodeHistory, loading: false, error: "" });
			} catch (error) {
				if (active) setState((current) => ({ ...current, loading: false, error: error instanceof Error && error.name !== "AbortError" ? error.message : "异常历史查询超时，请重试。" }));
			} finally { clearTimeout(timeout); busy = false; }
		};
		void request();
		const timer = setInterval(() => void request(), 30000);
		return () => { active = false; clearInterval(timer); controller?.abort(); };
	}, [table, range.from, range.to, page, reload, key]);
	const data = state.key === key ? state.data : null;
	const loading = state.key !== key || state.loading;
	const events = data?.events ?? [];
	const maxCount = Math.max(1, ...(data?.codes.map((code) => code.count) ?? []));
	const hasDurations = !!data && data.codes.every((code) => Number.isFinite(code.durationMs));
	const maxDuration = Math.max(1, ...(data?.codes.map((code) => code.durationMs) ?? []));
	const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));
	const emptyMessage = loading ? "正在读取异常历史…" : state.error ? "异常历史尚未读取成功" : "所选时间段暂无异常记录";
	return <>
		<section className="panel-card" aria-label="异常时间查询">
			<div className="section-heading"><h2>历史异常查询</h2><span className="group-count">全部历史采样</span></div>
			<form className="code-filters" onSubmit={(event) => {
				event.preventDefault();
				const begin = from ? new Date(`${from}+08:00`).toISOString() : "", end = to ? new Date(`${to}+08:00`).toISOString() : "";
				if (begin && end && begin > end) { setValidation("开始时间不能晚于结束时间。"); return; }
				setValidation(""); setRange({ from: begin, to: end }); setPage(1); setReload((value) => value + 1);
			}}>
				<DateTimeInput label="开始时间（北京时间）" value={from} onChange={setFrom} />
				<DateTimeInput label="结束时间（北京时间）" showNow value={to} onChange={setTo} />
				<button className="refresh-button" aria-busy={loading} disabled={loading}>{loading ? "查询异常中…" : "查询异常"}</button>
				<button type="button" className="code-reset" onClick={() => { setFrom(""); setTo(""); setRange({ from: "", to: "" }); setValidation(""); setPage(1); setReload((value) => value + 1); }}>全部时间</button>
			</form>
			<div aria-live="polite">{validation && <p className="notice error">{validation}</p>}{state.key === key && state.error && <p className="notice error">{data ? "历史查询失败，保留上次成功结果。" : ""}{state.error}</p>}{!!data?.invalidTimes && <p className="notice">{data.invalidTimes} 条采集时间无效的记录未参与事件时间计算。</p>}</div>
		</section>
		<section className="code-summary" aria-label="历史异常汇总">{[{ label: "异常记录", value: data?.total ?? null }, { label: "故障记录", value: data?.faults ?? null, className: "fault-code-active" }, { label: "报警记录", value: data?.alarms ?? null, className: "alarm-code-active" }, { label: "未观察到结束", value: data?.open ?? null }].map((item) => <div className="panel-card code-summary-card" key={item.label}><span>{item.label}</span><div><strong className={item.value ? item.className : undefined}>{item.value ?? "—"}</strong><span>{data ? "次" : loading ? "查询中" : "未读取"}</span></div></div>)}</section>
		<section className="panel-card" aria-label="历史代码分布"><div className="section-heading"><h2>历史代码分布</h2><span className="group-count">{data ? `${data.codes.length} 种代码` : loading ? "查询中" : "未读取"}</span></div>
			{data?.codes.length ? <div className="code-bars">{data.codes.map((entry) => <div className="code-bar" key={`${entry.field}/${entry.code}`}><span className="code-bar-label"><span>{fieldLabels[entry.field]}</span><strong className={codeClassName(entry.field, entry.code)}>{entry.code}</strong></span><span className="code-bar-track" aria-hidden="true"><span className={entry.field === "fault_code" ? "fault-bar" : "alarm-bar"} style={{ width: `${entry.count / maxCount * 100}%` }} /></span><span className="code-bar-count">{entry.count} 次</span></div>)}</div> : <p className="code-chart-empty">{emptyMessage}</p>}
			<section className="code-duration-distribution" aria-label="历史代码时长分布"><h3>代码观察时长（分）</h3>
				{hasDurations && data?.codes.length ? <div className="code-bars">{data.codes.map((entry) => <div className="code-bar code-duration-row" key={`${entry.field}/${entry.code}`}><span className="code-bar-label"><span>{fieldLabels[entry.field]}</span><strong className={codeClassName(entry.field, entry.code)}>{entry.code}</strong></span><span className="code-bar-track code-duration-track" aria-hidden="true"><span className="code-duration-bar" style={{ width: `${entry.durationMs / maxDuration * 100}%` }} /></span><span className="code-bar-count" title={displaySamplingSpan(entry.durationMs)}>{(entry.durationMs / 60000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 分</span></div>)}</div> : <p className="code-chart-empty">{data && !hasDurations ? "暂无历史时长数据" : emptyMessage}</p>}
				<p className="muted small">按匹配事件的完整跨度累计；未结束事件仅统计已观察时段。</p>
			</section>
		</section>
		<section className="panel-card" aria-label="历史异常记录"><div className="section-heading"><h2>历史异常记录</h2><span className="group-count">{data ? `${data.total} 条` : loading ? "查询中" : "未读取"}</span></div>
			<div className="table-scroll code-event-table"><table><thead><tr><th>类型</th><th>代码</th><th>首次观察（北京时间）</th><th>结束观察（北京时间）</th><th>观察时长</th><th>状态</th><th>采样回看</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{event.field === "fault_code" ? "故障" : "报警"}</td><td className={codeClassName(event.field, event.code)}>{event.code}</td><td>{displayTime(event.startedAt, false, true)}{event.startUncertain && <span className="event-time-note">最早观察时间</span>}</td><td>{event.endedAt ? displayTime(event.endedAt, false, true) : "未观察到结束"}</td><td>{!event.endedAt && event.samples === 1 ? "单点待续" : `${event.endedAt ? "" : "已观察 "}${displaySamplingSpan(Date.parse(event.endedAt ?? event.lastSeenAt) - Date.parse(event.startedAt))}`}</td><td>{event.ending === "zero" ? "已归零" : event.ending === "changed" ? "已换码" : "未观察到结束"}{!event.endedAt && <span className="event-time-note">最后观察：{displayTime(event.lastSeenAt, false, true)}</span>}{event.hasMissingSamples && <span className="event-time-note">采样缺失</span>}</td><td><button className="code-reset" title="查看事件已观察时段及前后各5分钟的采样" onClick={() => onViewEvent(event)}>查看前后趋势</button></td></tr>)}</tbody></table></div>
			{!events.length && <p className="empty-state">{emptyMessage}</p>}
			<div className="event-pagination"><button className="code-reset" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {pages} 页</span><button className="code-reset" disabled={loading || page >= pages} onClick={() => setPage(page + 1)}>下一页</button></div>
		</section>
	</>;
}
