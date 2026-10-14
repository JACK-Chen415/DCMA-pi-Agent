import { useEffect, useState } from "react";
import { CommunicationConfig } from "./CommunicationConfig.tsx";
import { dashboardTables, type DashboardSource } from "../database-types.ts";
import { displayTime, displayValue } from "../dashboard-view.ts";

const sections = [
	{ id: "status", title: "系统状态" },
	{ id: "authorization", title: "授权配置" },
	{ id: "device", title: "设备配置" },
	{ id: "monitoring", title: "监控配置" },
	{ id: "communication", title: "通信配置" },
	{ id: "realtime", title: "自定义实时数据" },
	{ id: "language", title: "语言/Language" },
	{ id: "other", title: "其他设置" },
] as const;

function currentSection() {
	return sections.find((section) => window.location.hash === `#settings/${section.id}`)?.id ?? "communication";
}

export function SystemConfig({ sources }: { sources: DashboardSource[] }) {
	const [active, setActive] = useState(currentSection);
	useEffect(() => {
		const navigate = () => setActive(currentSection());
		window.addEventListener("hashchange", navigate);
		return () => window.removeEventListener("hashchange", navigate);
	}, []);
	const section = sections.find((section) => section.id === active)!;
	return <div className="settings-layout">
		<nav className="settings-nav" aria-label="系统配置子菜单">{sections.map((section) => <a key={section.id} href={`#settings/${section.id}`} aria-current={active === section.id ? "page" : undefined}>{section.title}</a>)}</nav>
		<div className="settings-content">
			{active === "communication" ? <><h2 className="settings-title">通信配置</h2><CommunicationConfig /></> : active === "device" ? <section className="panel-card" aria-label="设备配置">
				<div className="section-heading"><h2>设备配置</h2><span className="group-count">只读 · 最近查询快照</span></div>
				<p className="muted small">采集标识用于核对数据来源。设备型号、额定参数及驱动／负载角色尚未确认。</p>
				<div className="table-scroll"><table><thead><tr><th>监控对象</th><th>数据来源</th><th>采集设备标识</th><th>采集变频器标识</th><th>最后采集（北京时间）</th><th>来源读取</th></tr></thead><tbody>{dashboardTables.map((table) => {
					const source = sources.find((item) => item.table === table);
					const motor = table === "real_data" ? 1 : Number(table.slice(-2));
					return <tr key={table}><td>G120 电机 {motor}</td><td>{table === "real_data" ? "历史真实采集" : "模拟数据"}</td><td>{displayValue(source?.latest?.raw.device_name)}</td><td>{displayValue(source?.latest?.raw.inverter_name)}</td><td>{displayTime(source?.latest?.acquiredAt)}</td><td>{!source ? "尚未读取" : source.available ? "已读取" : "不可读取"}</td></tr>;
				})}</tbody></table></div>
				<p className="muted small device-source-footer">标识与时间来自最近一次监控查询；进入配置页后不自动刷新。<a className="text-link" href="#overview">查看监控数据 →</a></p>
			</section> : <section className="panel-card settings-pending" aria-label={section.title}><h2>{section.title}</h2><p className="muted">页面内容待补充。</p></section>}
		</div>
	</div>;
}
