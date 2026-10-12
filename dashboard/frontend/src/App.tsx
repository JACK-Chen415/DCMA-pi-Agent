import { useEffect, useState } from "react";
import { fieldLabels, numericFields, type DashboardField, type DashboardRange, type DashboardTable, type NumericField } from "./database-types.ts";
import { displayTime, displayValue, displayRawField, codeClassName, displayFieldLabel, fieldUnits } from "./dashboard-view.ts";
import { useDashboard } from "./useDashboard.ts";
import { useSampleHistory } from "./useSampleHistory.ts";
import { Gauge } from "./components/Gauge.tsx";
import { TrendChart } from "./components/TrendChart.tsx";
import { RecentEvents } from "./components/RecentEvents.tsx";
import { CodeAnalysis } from "./components/CodeAnalysis.tsx";
import { DateTimeInput } from "./components/DateTimeInput.tsx";
import { SystemConfig } from "./components/SystemConfig.tsx";

const motorTables: DashboardTable[] = ["real_data_01", "real_data_02", "real_data_03", "real_data_04"];
const runningFields: DashboardField[] = ["inverter_load_rate", "motor_load_rate", "fault_code", "alarm_code"];
const codeFields: DashboardField[] = ["fault_code", "alarm_code", "control_word", "status_word"];
const fields = (Object.keys(fieldLabels) as DashboardField[]).filter((field) => field !== "status" && field !== "system_run_time");
const gaugeFields = ["speed_actual", "current_actual", "torque_actual", "dc_voltage", "inverter_temp", "motor_temp"] as const;
const gaugeRanges: Partial<Record<NumericField, { min: number; max: number }>> = {
	speed_actual: { min: -1500, max: 1500 }, current_actual: { min: 0, max: 3.3 },
	dc_voltage: { min: 0, max: 1200 }, inverter_temp: { min: 0, max: 150 }, motor_temp: { min: 0, max: 150 },
};
const views = [
	{ id: "overview", title: "设备概览", icon: "M3 10 12 3l9 7M5 9v12h14V9M9 21v-8h6v8" },
	{ id: "realtime", title: "实时数据", icon: "M3 3v18h18M6 15l4-5 4 3 6-8" },
	{ id: "metrics", title: "运行指标", icon: "M4 21V11h4v10M10 21V3h4v18M16 21v-7h4v7" },
	{ id: "codes", title: "故障与报警", icon: "m9 3-6 6v6l6 6h6l6-6V9l-6-6ZM12 7v6M12 16v1" },
	{ id: "records", title: "采样明细", icon: "M7 3h10l4 4v14H3V3h4M7 3v5h10V3M7 12h10M7 16h10" },
	{ id: "query", title: "数据查询", icon: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6M7 10h6M10 7v6" },
	{ id: "settings", title: "系统配置", icon: "M4 7h16M4 17h16M8 4v6M16 14v6" },
] as const;
type View = (typeof views)[number]["id"];
const metricGroups: { title: string; fields: NumericField[] }[] = [
	{ title: "运动参数", fields: ["speed_setpoint", "speed_actual", "torque_setpoint", "torque_actual"] },
	{ title: "电气参数", fields: ["dc_voltage", "current_actual", "field_current", "torque_current", "pulse_frequency"] },
	{ title: "功率参数", fields: ["actual_power", "motor_power", "feedback_power"] },
	{ title: "温度参数", fields: ["air_intake_temp", "motor_temp", "inverter_temp", "inverter_radiator_temp"] },
	{ title: "负荷参数", fields: ["inverter_load_rate", "motor_load_rate"] },
];
const parameterGroups: { title: string; fields: DashboardField[] }[] = [
	{ title: "设备信息", fields: ["device_name", "inverter_name"] },
	{ title: "采样信息", fields: ["id", "timestamp", "date", "time", "create_time"] },
	...metricGroups,
	{ title: "故障与控制", fields: codeFields },
];
function currentView(): View {
	if (window.location.hash === "#guide" || window.location.hash === "#communication" || window.location.hash.startsWith("#settings/")) return "settings";
	return views.find((view) => `#${view.id}` === window.location.hash)?.id ?? "realtime";
}
function NavIcon({ path }: { path: string }) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

export function App() {
	const [view, setView] = useState<View>(currentView);
	const [motor, setMotor] = useState(1);
	const [history, setHistory] = useState(false);
	const [limit, setLimit] = useState<50 | 100 | 200>(100);
	const [metric, setMetric] = useState<"speed" | "torque" | NumericField>("speed");
	const [from, setFrom] = useState(""), [to, setTo] = useState("");
	const [range, setRange] = useState<DashboardRange | null>(null);
	const [samplePage, setSamplePage] = useState(1);
	const [validation, setValidation] = useState("");
	const resetRange = () => { setRange(null); setFrom(""); setTo(""); setSamplePage(1); setValidation(""); };
	useEffect(() => {
		const navigate = () => { setView(currentView()); window.scrollTo(0, 0); };
		window.addEventListener("hashchange", navigate);
		return () => window.removeEventListener("hashchange", navigate);
	}, []);
	const table = motor === 1 && history ? "real_data" : motorTables[motor - 1];
	const browsingHistory = view === "query";
	const realtime = useDashboard(table, limit, !browsingHistory && view !== "settings");
	const samples = useSampleHistory(table, limit, browsingHistory ? range : null, samplePage);
	const { data, loading, error, refresh } = browsingHistory ? samples : realtime;
	const update = browsingHistory ? !range ? "请选择时间范围" : loading ? "正在查询历史采样" : error ? "历史采样查询失败" : "历史采样 · 手动刷新" : realtime.update;
	const pages = Math.max(1, Math.ceil((samples.data?.total ?? 0) / limit));
	const latest = data?.latest;
	const selectedSource = data?.sources.find((source) => source.table === table);
	const warnings = data?.warnings.filter((warning) => !data.sources.some((source) => source.table !== table && warning.startsWith(`${source.table}：`))) ?? [];
	const sourceLabel = table === "real_data" ? "历史真实采集" : "模拟数据";
	const page = views.find((item) => item.id === view)!;
	const chartFields: NumericField[] = metric === "speed" ? ["speed_setpoint", "speed_actual"] : metric === "torque" ? ["torque_setpoint", "torque_actual"] : [metric];
	const windowCount = browsingHistory ? samples.data ? `当前页 ${samples.data.returned} 条记录 · 共 ${samples.data.total} 条 · 曲线仅展示当前页` : loading ? "正在读取历史采样…" : "尚未获取查询结果" : `已返回 ${data?.returned ?? 0} 条记录，${data?.samples.length ?? 0} 条有效时间采样${data?.hasMore ? " · 仅展示最近窗口" : ""}${data?.truncated ? " · 响应已截断" : ""}`;
	const runningCards = (items: DashboardField[]) => items.map((field) => {
		const numeric = numericFields.includes(field as NumericField);
		return <div className="panel-card running-card" key={field}><span>{displayFieldLabel(field)}</span><strong className={codeClassName(field, latest?.raw[field])}>{numeric ? displayValue(latest?.values[field as NumericField]) : displayRawField(field, latest?.raw[field])}</strong></div>;
	});
	return (
		<div className="dashboard-shell">
			<aside className="sidebar">
				<div className="brand"><img src="/assets/logo.png" alt="" /><div><strong>DCMA</strong><span>电机与变频器监控</span></div></div>
				<p className="sidebar-caption">监控工作台</p>
				<nav className="sidebar-nav" aria-label="监控页面">{views.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={view === item.id ? "page" : undefined}><NavIcon path={item.icon} /><span>{item.title}</span>{view === item.id && <i aria-hidden="true" />}</a>)}</nav>
				{view !== "settings" && <div className="device-controls">
					<p className="sidebar-caption">当前监控设备</p>
					<label className="sidebar-label" htmlFor="device">查看设备</label>
					<select id="device" value={motor} onChange={(event) => { resetRange(); setMotor(Number(event.target.value)); }}>{motorTables.map((_, index) => <option key={index} value={index + 1}>G120 电机 {index + 1}</option>)}</select>
					<label className="sidebar-label" htmlFor="source">数据来源</label>
					<select id="source" value={motor === 1 && history ? "history" : "simulation"} disabled={motor !== 1} onChange={(event) => { resetRange(); setHistory(event.target.value === "history"); }}><option value="simulation">模拟数据</option>{motor === 1 && <option value="history">历史真实采集</option>}</select>
				</div>}
				<div className="sidebar-footer"><span className={`connection ${view === "settings" ? "" : error ? "failed" : data ? "connected" : ""}`} />{view === "settings" ? "系统配置 · 本机保存" : error ? "接口查询失败" : data ? "数据库查询成功" : browsingHistory && !range ? "等待历史查询" : "正在连接接口"}</div>
			</aside>
			<main className="dashboard-main">
				<header className="page-header"><div><p className="eyebrow">电机监控 / {page.title}</p><h1>{page.title}</h1></div>{view !== "settings" && <div className="header-actions"><label>{browsingHistory ? "每页条数" : "采样条数"} <select aria-label={browsingHistory ? "每页条数" : "采样条数"} value={limit} onChange={(event) => { setLimit(Number(event.target.value) as 50 | 100 | 200); setSamplePage(1); }}>{[50, 100, 200].map((value) => <option key={value} value={value}>{value} 条</option>)}</select></label><button className="refresh-button" onClick={refresh} disabled={loading || (browsingHistory && !range)}>{loading ? "正在查询…" : browsingHistory ? "刷新查询" : "刷新数据"}</button></div>}</header>
				{view !== "settings" && <>
				<section className="panel-card device-detail" aria-label="当前设备详情"><div className="detail-heading"><div><p className="eyebrow">当前设备{browsingHistory ? " · 历史采样" : ""}</p><h2>{latest ? displayValue(latest.raw.device_name) : `G120 电机 ${motor}`}</h2><p className="muted">变频器：{displayValue(latest?.raw.inverter_name)}</p></div><span className="source-badge">{sourceLabel}</span></div><div className="time-grid"><div><span>{browsingHistory ? "当前页最新采集（北京时间）" : "最后采集（北京时间）"}</span><strong>{displayTime(latest?.acquiredAt)}</strong></div><div><span>入库时间（北京时间）</span><strong>{displayTime(latest?.ingestedAt)}</strong></div><div><span>上次查询成功</span><strong>{displayTime(data?.queriedAt)}</strong></div><div><span>{browsingHistory ? "查询状态" : "采集更新状态"}</span><strong>{update}</strong></div></div></section>
				<div aria-live="polite">{error && <p className="notice error">{data ? "刷新失败，以下保留上次成功结果。" : "当前选择查询失败。"}{error}</p>}{!loading && data && !latest && <p className="notice">{browsingHistory ? "所选时间段暂无采样记录。" : selectedSource?.message || "当前来源暂无采样记录。"}</p>}{warnings.map((warning) => <p className="notice" key={warning}>{warning}</p>)}</div>
				</>}
				{browsingHistory && <section className="panel-card" aria-label="采样时间查询">
					<div className="section-heading"><h2>查询时间范围</h2><span className="group-count">北京时间 · 手动查询</span></div>
					<form className="code-filters" onSubmit={(event) => {
						event.preventDefault();
						try {
							const begin = new Date(`${from}+08:00`).toISOString(), end = new Date(`${to}+08:00`).toISOString();
							if (begin > end) { setValidation("开始时间不能晚于结束时间。"); return; }
							setValidation(""); setRange({ from: begin, to: end }); setSamplePage(1);
						} catch { setValidation("请填写有效的开始和结束时间。"); }
					}}>
						<DateTimeInput label="开始时间（北京时间）" required value={from} onChange={setFrom} />
						<DateTimeInput label="结束时间（北京时间）" required showNow value={to} onChange={setTo} />
						<button className="refresh-button" disabled={loading}>{loading ? "查询采样中…" : "查询数据"}</button>
						<button type="button" className="code-reset" onClick={() => { resetRange(); window.location.hash = "realtime"; }}>返回实时</button>
					</form>
					<div aria-live="polite">{validation && <p className="notice error">{validation}</p>}</div>
					{range ? <><p className="muted small">查询范围：{displayTime(range.from, false, true)} ～ {displayTime(range.to, false, true)}（北京时间，包含起止时刻）</p><div className="event-pagination"><button className="code-reset" disabled={loading || samplePage <= 1} onClick={() => setSamplePage(samplePage - 1)}>上一页</button><span>第 {samplePage} / {Math.max(samplePage, pages)} 页 · 共 {samples.data?.total ?? "—"} 条</span><button className="code-reset" disabled={loading || !samples.data || samplePage >= pages} onClick={() => setSamplePage(samplePage + 1)}>下一页</button></div></> : <p className="muted">选择起止时间后查询历史采样，结果按采集时间从新到旧分页，趋势图展示当前页记录。</p>}
				</section>}
				{view === "overview" && <>
					<section className="panel-card overview-intro"><div className="overview-copy"><div><p className="eyebrow">设备档案</p><h2>G120 电机 {motor}</h2></div><a className="text-link" href="#realtime">查看采样趋势 →</a></div><img className="equipment-illustration" src="/assets/illustrations/motor-drive.svg" alt="" aria-hidden="true" width="420" height="200" /></section>
					<section aria-label="运行信息" className="running-grid">{runningCards(runningFields)}</section>
					<section className="panel-card" aria-label="完整参数">
						<div className="section-heading"><h2>完整参数</h2><a className="text-link" href="#records">查看采样明细 →</a></div>
						<div className="parameter-groups">{parameterGroups.map((group) => <section className="parameter-group" key={group.title} aria-label={group.title}>
							<h3>{group.title}</h3>
							<dl className="parameter-grid">{group.fields.map((field) => <div key={field}><dt>{displayFieldLabel(field)}</dt><dd className={codeClassName(field, latest?.raw[field])}>{displayRawField(field, latest?.raw[field])}</dd></div>)}</dl>
						</section>)}</div>
					</section>
				</>}
				{(view === "realtime" || (browsingHistory && range)) && <>
					<section className="panel-card" aria-label="采样趋势">
						<div className="section-heading"><div><h2>采样趋势</h2></div><div className="chart-controls"><label>查看指标 <select aria-label="查看指标" value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}><optgroup label="对比曲线"><option value="speed">转速对比</option><option value="torque">转矩对比</option></optgroup><optgroup label="单项指标">{numericFields.map((field) => <option key={field} value={field}>{displayFieldLabel(field)}</option>)}</optgroup></select></label></div></div>
							{loading && !data ? <p className="chart-empty">正在读取当前设备采样…</p> : <TrendChart key={`${table}/${limit}/${metric}/${browsingHistory ? `${range?.from}/${range?.to}/${samplePage}` : "realtime"}`} samples={data?.samples ?? []} fields={chartFields} title={`${latest?.raw.device_name || `G120 电机 ${motor}`} · ${sourceLabel} · 采样趋势`} />}
						<p className="muted small window-count">{windowCount}</p>
					</section>
					{!browsingHistory && <><section aria-label="六项采样仪表" className="gauge-grid">{gaugeFields.map((field) => <Gauge key={field} label={fieldLabels[field]} unit={fieldUnits[field]!} value={latest?.values[field] ?? null} range={gaugeRanges[field]} samples={data?.samples.map((sample) => sample.values[field]) ?? []} />)}</section>
					<section aria-label="运行信息" className="running-grid">{runningCards(runningFields)}</section><RecentEvents table={table} records={data?.records ?? []} loading={loading} /></>}
				</>}
				{view === "metrics" && <div className="metric-groups">{metricGroups.map((group) => <section className="panel-card" key={group.title} aria-label={group.title}><div className="section-heading"><div><h2>{group.title}</h2></div><span className="group-count">{group.fields.length} 项指标</span></div><div className="metric-grid">{group.fields.map((field) => <div className="metric-card" key={field}><span>{displayFieldLabel(field)}</span><strong>{displayValue(latest?.values[field])}</strong><div><a href="#realtime" onClick={() => setMetric(field)} aria-label={`查看${fieldLabels[field]}趋势`}>查看趋势 →</a></div></div>)}</div></section>)}</div>}
				{view === "codes" && <>
					<section aria-label="当前代码" className="running-grid code-grid">{runningCards(codeFields)}</section>
					<CodeAnalysis key={table} table={table} records={data?.records ?? []} loading={loading} truncated={data?.truncated ?? false} />
				</>}
				{(view === "records" || (browsingHistory && range)) && <section className="panel-card" aria-label="原始采样明细"><div className="section-heading"><div><h2>原始采样记录</h2></div><span className="group-count">{browsingHistory ? `当前页 · ${limit} 条/页` : `最近 ${limit} 条`}</span></div><details open><summary>采样明细 · {data?.returned ?? 0} 条原始记录</summary><div className="table-scroll"><table><thead><tr>{fields.map((field) => <th key={field}>{displayFieldLabel(field)}</th>)}</tr></thead><tbody>{data?.records.map((record) => <tr key={record.id}>{fields.map((field) => <td key={field} className={codeClassName(field, record.raw[field])}>{displayRawField(field, record.raw[field])}</td>)}</tr>)}</tbody></table></div></details>{!data?.records.length && <p className="empty-state">{loading ? "正在读取采样记录…" : (browsingHistory ? "所选时间段暂无采样记录" : "当前来源暂无采样记录")}</p>}<p className="muted small window-count">{windowCount}</p></section>}
				{view === "settings" && <SystemConfig />}
			</main>
		</div>
	);
}
