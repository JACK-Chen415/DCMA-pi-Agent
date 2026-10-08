import { Check } from "lucide-react";
import { initialDevices, statusLabels } from "../mockData.ts";
import type { Device } from "../types.ts";
import { Modal } from "./Modal";
export function DeviceModal({
	onClose,
	currentDevice,
	onSelectDevice,
}: {
	onClose: () => void;
	currentDevice: Device;
	onSelectDevice: (device: Device) => void;
}) {
	return (
		<Modal title="切换目标监测设备" subtitle="各设备拥有独立数据集；切换设备会开启新对话" onClose={onClose}>
			<div className="space-y-3">
				{initialDevices.map((device) => (
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
						<div className="flex-1">
							<strong className="text-sm">{device.name}</strong>
							<span
								className={`text-[10px] ml-2 ${device.status === "warning" ? "text-amber-700" : "text-emerald-700"}`}
							>
								{statusLabels[device.status]}
							</span>
							<p className="text-xs text-slate-500 mt-1">
								{device.code} · {device.location}
							</p>
						</div>
						{device.id === currentDevice.id && <Check className="w-4 h-4 text-blue-600" />}
					</button>
				))}
			</div>
		</Modal>
	);
}
