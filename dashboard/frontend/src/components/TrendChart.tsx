import { useEffect, useId, useRef, useState } from "react";
import { type ExportResult, exportResultMessage, saveExportFile } from "../../../../packages/web/src/download.ts";
import type { DashboardSample, NumericField } from "../database-types.ts";
import { displayFieldLabel, displayRaw, displayTime } from "../dashboard-view.ts";
import { LineChart } from "./LineChart.tsx";

export function TrendChart({ samples, fields, title }: { samples: DashboardSample[]; fields: NumericField[]; title: string }) {
	const container = useRef<HTMLDivElement>(null);
	const dataId = useId();
	const [showData, setShowData] = useState(false);
	const [fullscreen, setFullscreen] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const [error, setError] = useState("");
	const [exportResult, setExportResult] = useState<ExportResult | null>(null);
	const hasValues = samples.some((sample) => fields.some((field) => sample.values[field] !== null));
	useEffect(() => {
		const changed = () => setFullscreen(document.fullscreenElement === container.current);
		document.addEventListener("fullscreenchange", changed);
		return () => document.removeEventListener("fullscreenchange", changed);
	}, []);
	const enlarge = async () => {
		setError("");
		try {
			if (document.fullscreenElement === container.current) await document.exitFullscreen();
			else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
			else throw new Error("Fullscreen unavailable");
		} catch { setError("无法进入全屏，请检查浏览器是否允许全屏查看。"); }
	};
	const download = async () => {
		const svg = container.current?.querySelector(".chart-surface svg");
		if (!svg || downloading) return;
		setDownloading(true); setError(""); setExportResult(null);
		let svgUrl = "";
		try {
			const copy = svg.cloneNode(true) as SVGSVGElement;
			copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
			copy.setAttribute("width", "1000"); copy.setAttribute("height", "255");
			copy.setAttribute("preserveAspectRatio", "xMidYMid meet");
			const originalTexts = svg.querySelectorAll("text");
			copy.querySelectorAll("text").forEach((text, index) => {
				const style = getComputedStyle(originalTexts[index]);
				text.style.fill = style.fill; text.style.fontSize = style.fontSize; text.style.fontFamily = style.fontFamily;
			});
			svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
			const picture = new Image();
			await new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error("Image unavailable")); picture.src = svgUrl; });
			const canvas = document.createElement("canvas");
			canvas.width = 1600; canvas.height = 560;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas unavailable");
			context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = "#1e293b"; context.font = "bold 26px sans-serif"; context.fillText(title, 40, 40);
			context.fillStyle = "#64748b"; context.font = "18px sans-serif";
			context.fillText(`${displayTime(samples[0].acquiredAt)} ～ ${displayTime(samples.at(-1)!.acquiredAt)}（北京时间）`, 40, 73);
			fields.forEach((field, index) => {
				context.fillStyle = svg.querySelectorAll("path")[index]?.getAttribute("stroke") ?? "#2563eb";
				context.fillText(`${displayFieldLabel(field)}${index ? "（虚线）" : "（实线）"}`, 40 + index * 550, 105);
			});
			context.drawImage(picture, 40, 125, 1520, 387.6);
			const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG unavailable")), "image/png"));
			setExportResult(await saveExportFile(`采样趋势-${fields.join("-")}-${Date.now()}.png`, blob));
		} catch (failure) { setError(failure instanceof Error ? failure.message : "图表保存失败，请重试。"); }
		finally { if (svgUrl) URL.revokeObjectURL(svgUrl); setDownloading(false); }
	};
	return <div className="trend-widget" ref={container}>
		{fullscreen && <h2>{title}</h2>}
		<div className="chart-actions" aria-label="图表工具">
			<button type="button" className="chart-tool" aria-label="下载图表" title="下载图表：将当前曲线保存为 PNG 图片" disabled={!hasValues || downloading} onClick={() => void download()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg></button>
			<button type="button" className="chart-tool" aria-label={fullscreen ? "退出全屏" : "放大查看"} title={fullscreen ? "退出全屏（也可按 Esc）" : "放大查看：全屏显示当前曲线"} disabled={!samples.length} onClick={() => void enlarge()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1" /></svg></button>
			<button type="button" className="chart-tool" aria-label="数据视图" title="数据视图：查看曲线对应的时间与指标数值" aria-expanded={showData} aria-controls={dataId} onClick={() => setShowData(!showData)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 9h16M4 14h16M10 4v16" /></svg></button>
		</div>
		<LineChart samples={samples} fields={fields} />
		{error && <p className="notice error" role="alert">{error}</p>}
		{exportResult && <output className="notice" style={{ overflowWrap: "anywhere" }}>{exportResultMessage(exportResult)}</output>}
		{showData && <section className="chart-data-view" id={dataId} aria-label="曲线数据视图"><h3>数据视图 · {samples.length} 条采样</h3><div className="table-scroll"><table><thead><tr><th>采集时间（北京时间）</th>{fields.map((field) => <th key={field}>{displayFieldLabel(field)}</th>)}</tr></thead><tbody>{samples.map((sample) => <tr key={sample.id}><td>{displayTime(sample.acquiredAt)}</td>{fields.map((field) => <td key={field}>{displayRaw(sample.values[field])}</td>)}</tr>)}</tbody></table></div>{!samples.length && <p className="empty-state">当前曲线暂无采样记录</p>}</section>}
	</div>;
}
