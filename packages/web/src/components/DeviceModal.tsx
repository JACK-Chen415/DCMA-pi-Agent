import { DevicePicker } from "../../../../dashboard/frontend/src/components/DevicePicker.tsx";
import type { Device } from "../types.ts";

export function DeviceModal({
	onClose,
	currentDevice,
	onSelectDevice,
	devices,
}: {
	onClose: () => void;
	currentDevice: Device;
	onSelectDevice: (device: Device) => void;
	devices: Device[];
}) {
	return (
		<DevicePicker
			devices={devices}
			currentId={currentDevice.id}
			subtitle="各设备拥有独立数据集；切换设备会开启新对话"
			onClose={onClose}
			onSelect={(id) => {
				const selected = devices.find((device) => device.id === id);
				if (selected && selected.id !== currentDevice.id) onSelectDevice(selected);
			}}
		/>
	);
}
