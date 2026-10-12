import { useState } from "react";
import { fieldLabels } from "../database-types.ts";

const storageKey = "dcma.communication-config.v1";
const recordFields = [
	["记录日期", "RecodDate"], ["正向速度最大值", "ForwardMaxSpeed"],
	["正向速度最小值", "ForwardMinSpeed"], ["正向速度平均值", "ForwardAveSpeed"],
	["反向速度最大值", "ReverseMaxSpeed"], ["反向速度最小值", "ReverseMinSpeed"],
	["反向速度平均值", "ReverseAveSpeed"], ["正向速度限幅", "ForwardSpeedLimit"],
	["反向速度限幅", "ReverseSpeedLimit"], ["电流最大值", "MaxCurrent"],
	["电流最小值", "MinCurrent"], ["电流平均值", "AveCurrent"],
	["电流限幅", "CurrentLimit"], ["电动转矩最大值", "MaxMotorTorque"],
	["电动转矩最小值", "MinMotorTorque"], ["电动转矩平均值", "AveMotorTorque"],
	["制动转矩最大值", "MaxBrakeTorque"], ["制动转矩最小值", "MinBrakeTorque"],
	["制动转矩平均值", "AveBrakeTorque"], ["转矩正限幅", "ForwardTorqueLimit"],
];
const groups = [
	{ title: "数据记录", fields: recordFields },
	{ title: "逆变器数据", fields: Object.entries(fieldLabels).filter(([key]) => key !== "status" && key !== "system_run_time").map(([key, label]) => [label, key]) },
];
const defaults = {
	enabled: true, host: "", port: "1883", username: "", interval: "1", unit: "秒",
	recordTopic: "Realdata_MM", realtimeTopic: "Realdata_MM",
	parameters: groups.map((group) => group.fields.map(([, name]) => ({ enabled: true, name }))),
};
type Settings = typeof defaults;

function readSettings(): { settings: Settings; message: string } {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return { settings: defaults, message: "" };
		const saved = JSON.parse(raw);
		if (!saved || typeof saved.enabled !== "boolean" ||
			["host", "port", "username", "interval", "recordTopic", "realtimeTopic"].some((key) => typeof saved[key] !== "string") ||
			!["秒", "分钟"].includes(saved.unit) || !Array.isArray(saved.parameters) || saved.parameters.length !== groups.length ||
			groups.some((group, index) => !Array.isArray(saved.parameters[index]) || saved.parameters[index].length !== group.fields.length ||
				saved.parameters[index].some((parameter: { enabled: unknown; name: unknown } | null) => !parameter || typeof parameter.enabled !== "boolean" || typeof parameter.name !== "string"))) {
			throw new Error("Invalid settings");
		}
		return { settings: Object.fromEntries(Object.keys(defaults).map((key) => [key, saved[key]])) as Settings, message: "" };
	} catch {
		return { settings: defaults, message: "无法读取本机配置，已显示默认值；修改后可重新保存。" };
	}
}

export function CommunicationConfig() {
	const [initial] = useState(readSettings);
	const [settings, setSettings] = useState(initial.settings);
	const [password, setPassword] = useState("");
	const [activeGroup, setActiveGroup] = useState(0);
	const [message, setMessage] = useState(initial.message);
	const [failed, setFailed] = useState(!!initial.message);
	const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
		setSettings((current) => ({ ...current, [key]: value }));
		setMessage("");
	};
	const editParameter = (index: number, patch: Partial<Settings["parameters"][number][number]>) => {
		change("parameters", settings.parameters.map((group, groupIndex) => groupIndex !== activeGroup ? group : group.map((parameter, fieldIndex) => fieldIndex !== index ? parameter : { ...parameter, ...patch })));
	};
	return <form className="communication-form" onSubmit={(event) => {
		event.preventDefault();
		setFailed(true);
		const invalidGroup = settings.parameters.findIndex((group) => group.some((parameter) => parameter.enabled && !parameter.name.trim()));
		if (invalidGroup >= 0) { setActiveGroup(invalidGroup); setMessage("请填写已勾选参数的名称。"); return; }
		try {
			localStorage.setItem(storageKey, JSON.stringify(settings));
			setFailed(false);
			setMessage("配置已保存到当前浏览器；尚未连接 MQTT 或发送数据。密码未保存。");
		} catch { setMessage("保存失败，请允许浏览器保存本机数据后重试。"); }
	}}>
		<section className="panel-card communication-settings" aria-label="通信设置">
			<div className="section-heading"><h2>通信设置</h2><span className="source-badge">本机配置</span></div>
			<p className="muted">配置仅保存在当前浏览器，尚未连接 MQTT 或发送数据；密码不保存。</p>
			<div className="communication-toolbar">
				<label className="communication-field">外部通信协议<select defaultValue="MQTT" aria-label="外部通信协议"><option>MQTT</option></select></label>
				<label className="communication-check"><input type="checkbox" checked={settings.enabled} onChange={(event) => change("enabled", event.target.checked)} />启用通信协议</label>
				<div className="communication-period"><label className="communication-field">数据发送周期<input type="number" min="1" max="86400" step="1" required value={settings.interval} onChange={(event) => change("interval", event.target.value)} /></label><label className="communication-field">单位<select value={settings.unit} onChange={(event) => change("unit", event.target.value)}><option>秒</option><option>分钟</option></select></label></div>
			</div>
			<div className="communication-grid">
				<label className="communication-field">服务器 IP 地址 / 主机名<input required maxLength={253} placeholder="192.168.1.100" value={settings.host} onChange={(event) => change("host", event.target.value.trim())} /></label>
				<label className="communication-field">服务器端口<input type="number" min="1" max="65535" step="1" required value={settings.port} onChange={(event) => change("port", event.target.value)} /></label>
				<label className="communication-field">服务器用户名<input maxLength={128} placeholder="admin" autoComplete="off" value={settings.username} onChange={(event) => change("username", event.target.value)} /></label>
				<label className="communication-field">服务器密码<input type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setMessage(""); }} /></label>
				<label className="communication-field">数据记录订阅主题<input required maxLength={256} value={settings.recordTopic} onChange={(event) => change("recordTopic", event.target.value)} /></label>
				<label className="communication-field">实时数据订阅主题<input required maxLength={256} value={settings.realtimeTopic} onChange={(event) => change("realtimeTopic", event.target.value)} /></label>
			</div>
		</section>
		<section className="panel-card" aria-label="通信参数">
			<div className="section-heading"><h2>通信参数</h2><span className="group-count">{settings.parameters[activeGroup].filter((parameter) => parameter.enabled).length} / {groups[activeGroup].fields.length} 项已勾选</span></div>
			<div className="communication-tabs" aria-label="参数分组">{groups.map((group, index) => <button type="button" key={group.title} aria-pressed={activeGroup === index} onClick={() => setActiveGroup(index)}>{group.title}</button>)}{["ALM数据", "SLM数据", "BLM数据"].map((title) => <button type="button" key={title} disabled title="尚未提供此分组的参数列表">{title} · 待补充</button>)}</div>
			<div className="communication-parameters">{groups[activeGroup].fields.map(([label, key], index) => {
				const parameter = settings.parameters[activeGroup][index];
				return <div className="communication-parameter" key={key}>
					<span className="communication-number">{String(index + 1).padStart(2, "0")}</span>
					<label className="communication-check"><input type="checkbox" checked={parameter.enabled} onChange={(event) => editParameter(index, { enabled: event.target.checked })} />{label}</label>
					<label className="communication-field"><span>参数名称</span><input aria-label={`${label}参数名称`} maxLength={128} disabled={!parameter.enabled} value={parameter.name} onChange={(event) => editParameter(index, { name: event.target.value })} /></label>
				</div>;
			})}</div>
		</section>
		<div className="communication-save"><p role="status" className={failed ? "notice error" : "muted"}>{message || "编辑完成后，保存本机配置。"}</p><button className="refresh-button" type="submit">保存本机配置</button></div>
	</form>;
}
