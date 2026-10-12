import { useEffect, useState } from "react";
import { CommunicationConfig } from "./CommunicationConfig.tsx";

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

export function SystemConfig() {
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
			{active === "communication" ? <><h2 className="settings-title">通信配置</h2><CommunicationConfig /></> : <section className="panel-card settings-pending" aria-label={section.title}><h2>{section.title}</h2><p className="muted">页面内容待补充。</p></section>}
		</div>
	</div>;
}
