import { useEffect, useRef } from "react";
import type { DeviceAssessment } from "../database-types.ts";
import "./DevicePicker.css";

export interface DeviceChoice {
	id: string;
	code: string;
	name: string;
	image: string;
	sourceLabel?: string;
	assessment?: DeviceAssessment;
}

export function DevicePicker({ devices, currentId, onSelect, onClose, subtitle, error = "" }: {
	devices: DeviceChoice[];
	currentId: string;
	onSelect: (id: string) => void;
	onClose: () => void;
	subtitle: string;
	error?: string;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	return (
		<dialog ref={ref} className="device-picker" aria-labelledby="device-picker-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
			<div className="device-picker-heading"><div><h2 id="device-picker-title">切换设备</h2><p>{subtitle}</p></div><button type="button" onClick={onClose} aria-label="关闭设备选择">×</button></div>
			<div className="device-picker-list">{devices.map((device) => {
				const assessment = device.assessment;
				const expired = assessment?.expiresAt !== undefined && assessment.expiresAt !== null && (!Number.isFinite(Date.parse(assessment.expiresAt)) || Date.now() > Date.parse(assessment.expiresAt));
				const uncertain = !!error || expired || !assessment;
				const label = error ? "状态未确认" : expired ? "数据已过期" : assessment?.label ?? "状态未确认";
				return <button type="button" className="device-picker-option" key={device.id} aria-pressed={device.id === currentId} onClick={() => { onSelect(device.id); onClose(); }}>
					<img src={device.image} alt="设备示意图" /><span className="device-picker-copy"><span className="device-picker-name"><strong>{device.name}</strong><span className="device-picker-status" data-tone={uncertain ? "neutral" : assessment?.tone} title={error || assessment?.detail}>{label}</span></span><span className="device-picker-source">{device.sourceLabel} · {device.code}</span><span className="device-picker-time">最新采样：{assessment?.latestAt && Number.isFinite(Date.parse(assessment.latestAt)) ? new Date(assessment.latestAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未取得有效时间"}</span>{(uncertain || assessment?.tone === "neutral") && <span className="device-picker-detail">{error || (expired ? "最新采样超过有效时间，不能确认当前状态。" : assessment?.detail)}</span>}</span>{device.id === currentId && <span className="device-picker-check" aria-label="已选中">✓</span>}
				</button>;
			})}</div>
			<p className="device-picker-note">每3秒检查最新采样。历史采集与模拟数据分别标注；未报告故障或报警不代表整体健康。</p>
		</dialog>
	);
}
