import {
	Activity,
	AlertTriangle,
	BarChart2,
	ChevronRight,
	Clock,
	FolderClosed,
	Thermometer,
	Wrench,
	X,
	Zap,
} from "lucide-react";
import { statusLabels } from "../mockData.ts";
import type { Dataset, Device, MetricData } from "../types.ts";
import { LineChart } from "./LineChart";
export function RightPanel({
	device,
	metrics,
	dataset,
	threshold,
	checkedAt,
	intervalMs,
	onSwitchDevice,
	onViewMoreTelemetry,
	onQuickAction,
	onImport,
	onRestoreDemo,
	disabled,
	open,
	onClose,
}: {
	device: Device;
	metrics: MetricData[];
	dataset: Dataset;
	threshold: number;
	checkedAt: string;
	intervalMs: number;
	onSwitchDevice: () => void;
	onViewMoreTelemetry: () => void;
	onQuickAction: (action: string) => void;
	onImport: () => void;
	onRestoreDemo: () => void;
	disabled: boolean;
	open: boolean;
	onClose: () => void;
}) {
	const temperature = metrics.find((metric) => metric.id === "temperature")?.value;
	const alarm = typeof temperature === "number" && temperature > threshold;
	const warning = device.status === "warning" || alarm;
	return (
		<aside
			aria-label="设备看板"
			className={`${open ? "flex fixed inset-y-0 right-0 bg-[#f4f7fb] shadow-xl z-40" : "hidden xl:flex"} w-[320px] max-w-[92vw] h-full flex-col shrink-0 px-3 py-5 space-y-4 overflow-y-auto`}
		>
			{open && (
				<button type="button" onClick={onClose} aria-label="关闭设备看板" className="self-end">
					<X className="w-5 h-5" />
				</button>
			)}
			<section className="panel-card">
				<div className="flex items-center justify-between mb-3">
					<h3 className="font-bold text-sm">当前设备</h3>
					<button type="button" onClick={onSwitchDevice} className="text-xs text-blue-600 flex items-center">
						切换设备
						<ChevronRight className="w-3 h-3" />
					</button>
				</div>
				<img
					src={device.image}
					alt={`${device.name}设备示意图`}
					className="w-full h-28 object-cover rounded-xl mb-3"
				/>
				<div className="flex flex-wrap gap-2 items-center mb-3">
					<strong className="text-sm">{device.name}</strong>
					<span
						className={`text-[11px] px-2 py-1 rounded-full ${warning ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
					>
						{statusLabels[device.status]}
					</span>
					{alarm && <span className="text-[11px] text-red-600">采样温度超阈值</span>}
				</div>
				<dl className="text-xs grid grid-cols-[64px_1fr] gap-y-2">
					<dt className="text-slate-500">ID</dt>
					<dd>{device.code}</dd>
					<dt className="text-slate-500">类型</dt>
					<dd>{device.type}</dd>
					<dt className="text-slate-500">位置</dt>
					<dd>{device.location}</dd>
					<dt className="text-slate-500">投运时间</dt>
					<dd>{device.commissionDate}</dd>
				</dl>
			</section>
			<section className="panel-card">
				<div className="flex justify-between items-center mb-2">
					<h3 className="text-sm font-bold">监测数据</h3>
					<button type="button" onClick={onViewMoreTelemetry} className="text-xs text-blue-600">
						查看更多
					</button>
				</div>
				<p className={`text-[11px] mb-3 ${dataset.imported ? "text-blue-600" : "text-amber-700"}`}>
					{dataset.source}
				</p>
				<div className="grid grid-cols-2 gap-2">
					{metrics.map((metric) => (
						<div key={metric.id} className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
							<div className="text-[11px] text-slate-500 flex gap-1 items-center">
								{metric.id === "temperature" ? (
									<Thermometer className="w-3 h-3" />
								) : metric.id === "vibration" ? (
									<Activity className="w-3 h-3" />
								) : metric.id === "current" ? (
									<Zap className="w-3 h-3" />
								) : (
									<Clock className="w-3 h-3" />
								)}
								{metric.label}
							</div>
							<p className={`mt-1 ${metric.accentColor === "amber" ? "text-red-600" : "text-slate-800"}`}>
								<strong className="text-lg">{metric.value}</strong>{" "}
								<span className="text-[10px]">{metric.unit}</span>
							</p>
							<LineChart
								compact
								label={metric.label}
								points={metric.sparkline.map((value, index) => ({ name: String(index), value }))}
							/>
							<p className="text-[10px] text-slate-500 mt-1">较前点 {metric.change}</p>
						</div>
					))}
				</div>
				<p className="text-[10px] text-slate-400 mt-3">
					{dataset.samples.length} 个采样点 · 每 {intervalMs / 1000}s 检查服务
					<br />
					检查时间：{checkedAt || "正在连接"}
				</p>
				<div className="flex gap-3 mt-3">
					<button type="button" onClick={onImport} className="text-xs text-blue-600">
						导入 CSV / LOG
					</button>
					{dataset.imported && (
						<button type="button" onClick={onRestoreDemo} className="text-xs text-slate-500">
							恢复示例数据
						</button>
					)}
				</div>
			</section>
			<section className="panel-card">
				<h3 className="text-sm font-bold mb-3">快捷操作</h3>
				<div className="grid grid-cols-2 gap-2">
					{[
						{ id: "generate_report", label: "生成运行报表", Icon: BarChart2 },
						{ id: "parse_fault_code", label: "故障码解析", Icon: AlertTriangle },
						{ id: "device_archive", label: "设备档案查询", Icon: FolderClosed },
						{ id: "maintenance_advice", label: "维护建议", Icon: Wrench },
					].map(({ id, label, Icon }) => (
						<button
							type="button"
							key={id}
							disabled={disabled}
							onClick={() => onQuickAction(id)}
							className="bg-slate-50 hover:bg-blue-50 rounded-xl p-2 flex gap-1.5 items-center text-[11px] disabled:opacity-40"
						>
							<Icon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
							{label}
						</button>
					))}
				</div>
			</section>
		</aside>
	);
}
