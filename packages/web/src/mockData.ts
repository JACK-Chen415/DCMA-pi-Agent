import type { AppSettings, Dataset, Device, SuggestionCard } from "./types.ts";
export const initialDevices: Device[] = [
	{
		id: "gen-05",
		code: "GEN-05",
		name: "五号发电机",
		type: "大型发电机组",
		location: "1号厂房",
		commissionDate: "2020-03-12",
		status: "running",
		image: "/assets/gen_photo.png",
	},
	{
		id: "tr-03",
		code: "TR-03",
		name: "三号主变压器",
		type: "220kV电力变压器",
		location: "户外升压站",
		commissionDate: "2019-08-15",
		status: "running",
		image: "/assets/gen_photo.png",
	},
	{
		id: "tur-02",
		code: "TUR-02",
		name: "二号水轮机",
		type: "混流式水轮机",
		location: "2号地下厂房",
		commissionDate: "2021-11-04",
		status: "running",
		image: "/assets/gen_photo.png",
	},
	{
		id: "comp-01",
		code: "COMP-01",
		name: "一号空压机",
		type: "双螺杆空压机组",
		location: "动力辅助车间",
		commissionDate: "2022-05-18",
		status: "warning",
		image: "/assets/gen_photo.png",
	},
];
export const statusLabels: Record<Device["status"], string> = {
	running: "运行中",
	warning: "预警关注",
	stopped: "已停机",
	maintenance: "维护中",
};
export const defaultSettings: AppSettings = {
	model: "",
	telemetryIntervalMs: 3000,
	alarmThreshold: 75,
};
export function createDemoDatasets(): Record<string, Dataset> {
	const end = new Date();
	end.setMinutes(0, 0, 0);
	return Object.fromEntries(
		initialDevices.map((device, index) => [
			device.id,
			{
				source: "示例数据（非现场采集）",
				imported: false,
				samples: Array.from({ length: 24 }, (_, i) => ({
					timestamp: new Date(end.getTime() - (23 - i) * 3600000).toISOString(),
					temperature: +(46 + index * 9 + Math.sin(i / 3) * 3 + (i === 10 || i === 17 ? 8 : 0)).toFixed(1),
					vibration: +(0.3 + index * 0.08 + Math.sin(i / 2) * 0.03).toFixed(3),
					current: +(310 + index * 25 + Math.cos(i / 4) * 12).toFixed(1),
					...(device.id !== "tr-03" ? { speed: 1498 - index * 50 + Math.round(Math.sin(i) * 2) } : {}),
				})),
			} as Dataset,
		]),
	);
}
export const suggestionCards: SuggestionCard[] = [
	{
		id: "s1",
		title: "设备信息查询",
		query: "查询当前设备的基本信息和数据状态",
		iconBg: "bg-blue-50",
		iconColor: "text-blue-600",
		iconType: "search",
	},
	{
		id: "s2",
		title: "数据分析与可视化",
		query: "统计当前数据中温度超过50℃的采样点与事件次数，并生成折线图",
		iconBg: "bg-indigo-50",
		iconColor: "text-indigo-600",
		iconType: "chart",
	},
	{
		id: "s3",
		title: "故障诊断分析",
		query: "分析当前设备的异常指标，并给出故障排查建议",
		iconBg: "bg-red-50",
		iconColor: "text-red-500",
		iconType: "alert",
	},
	{
		id: "s4",
		title: "维护建议",
		query: "基于当前数据给出设备维护建议",
		iconBg: "bg-emerald-50",
		iconColor: "text-emerald-600",
		iconType: "clipboard",
	},
];
