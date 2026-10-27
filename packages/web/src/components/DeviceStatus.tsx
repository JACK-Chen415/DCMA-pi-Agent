import { statusLabels } from "../mockData.ts";
import type { Device } from "../types.ts";

const tones = {
	neutral: "bg-slate-100 text-slate-600",
	info: "bg-blue-50 text-blue-700",
	success: "bg-emerald-50 text-emerald-700",
	warning: "bg-amber-50 text-amber-700",
	danger: "bg-red-50 text-red-700",
};

export function DeviceStatus({ device }: { device: Device }) {
	const tone =
		device.assessment?.tone ??
		(device.status === "running"
			? "success"
			: device.status === "warning"
				? "warning"
				: device.status === "fault"
					? "danger"
					: "neutral");
	return (
		<span
			className={`inline-block text-[11px] px-2 py-1 rounded-full ${tones[tone]}`}
			title={device.assessment?.detail}
		>
			{device.assessment?.label ?? statusLabels[device.status]}
		</span>
	);
}

export function DeviceStateDetails({ device, compact = false }: { device: Device; compact?: boolean }) {
	if (!device.assessment) return null;
	const latest = device.assessment.latestAt;
	return (
		<div className="text-[11px] text-slate-500 leading-5 mt-2 break-words">
			{(!compact || device.assessment.tone === "neutral") && <p>{device.assessment.detail}</p>}
			<p>
				最新采样：
				{latest && Number.isFinite(Date.parse(latest))
					? new Date(latest).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
					: "未取得有效时间"}
				（北京时间）
			</p>
			{!compact && device.assessment.ruleSource && (
				<p>
					判断依据：{device.assessment.ruleSource.source} · {device.assessment.ruleSource.version}
				</p>
			)}
		</div>
	);
}
