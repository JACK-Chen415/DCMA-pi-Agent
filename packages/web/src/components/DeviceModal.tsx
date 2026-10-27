import { Check } from "lucide-react";
import { initialDevices } from "../mockData.ts";
import type { Device } from "../types.ts";
import { DeviceStateDetails, DeviceStatus } from "./DeviceStatus";
import { Modal } from "./Modal";
export function DeviceModal({
	onClose,
	currentDevice,
	onSelectDevice,
	devices,
}: {
	onClose: () => void;
	currentDevice: Device;
	onSelectDevice: (device: Device) => void;
	devices?: Device[];
}) {
	return (
		<Modal title="切换目标监测设备" subtitle="各设备拥有独立数据集；切换设备会开启新对话" onClose={onClose}>
			<div className="space-y-3">
				{(devices ?? initialDevices).map((device) => (
					<button
						type="button"
						key={device.id}
						onClick={() => {
							onSelectDevice(device);
							onClose();
						}}
						className={`w-full text-left p-3 rounded-xl border flex gap-3 items-center ${device.id === currentDevice.id ? "bg-blue-50 border-blue-500" : "border-slate-200 hover:bg-slate-50"}`}
					>
						<img className="w-12 h-12 rounded-xl object-cover" src={device.image} alt="设备示意图" />
						<div className="flex-1 min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<strong className="text-sm">{device.name}</strong>
								<DeviceStatus device={device} />
							</div>
							<p className="text-xs text-slate-500 mt-1">
								{device.sourceLabel && `${device.sourceLabel} · `}
								{device.code}
								{device.location !== "未提供" && ` · ${device.location}`}
							</p>
							<DeviceStateDetails device={device} compact />
						</div>
						{device.id === currentDevice.id && <Check className="w-4 h-4 text-blue-600" />}
					</button>
				))}
			</div>
			<p className="mt-3 text-[11px] leading-5 text-slate-500">
				每3秒检查最新采样；超过60秒未更新则撤销当前状态。未报告故障/报警不代表运行中或整体健康；运行、停机需有明确规则依据。
			</p>
		</Modal>
	);
}
