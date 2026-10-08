import { useMemo, useState } from "react";
import { downloadText } from "../download.ts";
import { getChartPoints, getMetrics, getSpectrum, metricDefinitions, telemetryCsv } from "../telemetry.ts";
import type { Dataset, Device, MetricKey } from "../types.ts";
import { LineChart } from "./LineChart";
import { Modal } from "./Modal";
export function TelemetryModal({
	onClose,
	device,
	dataset,
	threshold,
}: {
	onClose: () => void;
	device: Device;
	dataset: Dataset;
	threshold: number;
}) {
	const [metric, setMetric] = useState<MetricKey>("temperature");
	const [spectrumMode, setSpectrumMode] = useState(false);
	const spectrum = useMemo(() => getSpectrum(dataset.samples), [dataset.samples]);
	const definition = metricDefinitions.find((item) => item.id === metric)!;
	return (
		<Modal title={`${device.name} · 监测数据详情`} subtitle={dataset.source} onClose={onClose}>
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
				{getMetrics(dataset.samples, threshold).map((item) => (
					<div key={item.id} className="bg-slate-50 rounded-xl p-3 text-xs">
						<p className="text-slate-500">{item.label}</p>
						<strong>
							{item.value} {item.unit}
						</strong>
					</div>
				))}
			</div>
			<div className="flex flex-wrap gap-2 mb-4">
				{metricDefinitions.map((item) => (
					<button
						type="button"
						key={item.id}
						aria-pressed={metric === item.id && !spectrumMode}
						onClick={() => {
							setMetric(item.id);
							setSpectrumMode(false);
						}}
						className={`text-xs px-3 py-2 rounded-xl ${metric === item.id && !spectrumMode ? "bg-blue-600 text-white" : "bg-slate-100"}`}
					>
						{item.label}时序
					</button>
				))}
				<button
					type="button"
					aria-pressed={spectrumMode}
					onClick={() => setSpectrumMode(true)}
					className={`text-xs px-3 py-2 rounded-xl ${spectrumMode ? "bg-blue-600 text-white" : "bg-slate-100"}`}
				>
					振动频谱
				</button>
			</div>
			{spectrumMode ? (
				<>
					<p className="text-xs text-slate-500 mb-3">{spectrum.message}</p>
					<LineChart points={spectrum.points} label="振动幅值频谱（mm/s）" />
				</>
			) : (
				<>
					<p className="text-xs">
						{definition.label}（{definition.unit}）{metric === "temperature" && ` · 阈值 ${threshold} ℃`}
					</p>
					<LineChart
						points={getChartPoints(dataset.samples, metric)}
						threshold={metric === "temperature" ? threshold : undefined}
						label={`${definition.label}（${definition.unit}）`}
					/>
				</>
			)}
			<p className="text-[11px] text-slate-500 my-3">
				共 {dataset.samples.length} 个采样点。无数据的通道显示“—”。设备图片为示意图。
			</p>
			<div className="flex justify-between border-t border-slate-100 pt-3">
				<button
					type="button"
					onClick={() =>
						downloadText(`${device.code}_telemetry.csv`, telemetryCsv(dataset.samples), "text/csv;charset=utf-8")
					}
					className="text-xs px-3 py-2 bg-slate-100 rounded-xl"
				>
					导出时序数据 (CSV)
				</button>
				<button type="button" onClick={onClose} className="text-xs px-3 py-2 bg-blue-600 text-white rounded-xl">
					关闭窗口
				</button>
			</div>
		</Modal>
	);
}
