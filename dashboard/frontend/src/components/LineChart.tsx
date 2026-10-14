import { useEffect, useId, useRef, useState } from "react";
import type { DashboardSample, NumericField } from "../database-types.ts";
import { fieldLabels } from "../database-types.ts";
import { displayTime, displayValue, displayFieldLabel, fieldUnits, linePath, sampleRange } from "../dashboard-view.ts";

const colors = ["#2563eb", "#d97706"];
const left = 64, top = 18;

export function LineChart({ samples, fields }: { samples: DashboardSample[]; fields: NumericField[] }) {
	const titleId = useId();
	const [selected, setSelected] = useState<number | null>(null);
	const surface = useRef<SVGSVGElement>(null);
	const [size, setSize] = useState({ width: 1000, height: 255 });
	const range = sampleRange(samples.flatMap((sample) => fields.map((field) => sample.values[field])));
	const hasData = !!samples.length && !!range;
	useEffect(() => {
		if (!surface.current) return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			if (width > left + 20 && height > 60) setSize({ width, height });
		});
		observer.observe(surface.current);
		return () => observer.disconnect();
	}, [hasData]);
	if (!samples.length || !range) return <p className="chart-empty">当前采样窗口暂无有效{fields.map((field) => fieldLabels[field]).join(" / ")}曲线数据</p>;
	const right = size.width - 18, bottom = size.height - 35;
	const ticks = size.width < 480 ? 2 : 4;
	const padding = (range.max - range.min) * .12;
	const min = range.min - padding, max = range.max + padding;
	const start = new Date(samples[0].acquiredAt).getTime();
	const end = new Date(samples.at(-1)!.acquiredAt).getTime();
	const x = (sample: DashboardSample) => end === start ? (left + right) / 2 : left + (new Date(sample.acquiredAt).getTime() - start) / (end - start) * (right - left);
	const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
	const index = selected === null ? null : Math.min(selected, samples.length - 1);
	const current = index === null ? null : samples[index];
	return <div className="trend-chart">
		<div className="chart-legend">{fields.map((field, series) => <span key={field}><i style={{ background: colors[series] }} className={series ? "dashed" : ""} />{displayFieldLabel(field)}{series ? "（虚线）" : "（实线）"}</span>)}</div>
		<div className="chart-surface">
			<svg ref={surface} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" tabIndex={0} role="group" aria-labelledby={titleId}
				onPointerMove={(event) => {
					const bounds = event.currentTarget.getBoundingClientRect();
					const cursor = (event.clientX - bounds.left) / bounds.width * size.width;
					let nearest = 0;
					for (let i = 1; i < samples.length; i++) if (Math.abs(x(samples[i]) - cursor) <= Math.abs(x(samples[nearest]) - cursor)) nearest = i;
					setSelected(nearest);
				}}
				onPointerLeave={() => setSelected(null)} onFocus={() => setSelected(samples.length - 1)} onBlur={() => setSelected(null)}
				onKeyDown={(event) => {
					if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
					event.preventDefault();
					if (event.key === "Escape") setSelected(null);
					else if (event.key === "Home") setSelected(0);
					else if (event.key === "End") setSelected(samples.length - 1);
					else setSelected(Math.max(0, Math.min(samples.length - 1, (index ?? samples.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
				}}>
				<title id={titleId}>{fields.map((field) => fieldLabels[field]).join("与")}趋势，{samples.length}条采样{fieldUnits[fields[0]] ? `。单位：${fieldUnits[fields[0]]}` : ""}。左右箭头查看相邻采样，Home/End查看首尾，Esc关闭提示。缺失值不连线。</title>
				{Array.from({ length: ticks + 1 }, (_, tick) => {
					const value = min + (max - min) * tick / ticks;
					return <g key={tick}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e8eef5" /><text x={left - 12} y={y(value) + 4} textAnchor="end">{Number(value.toPrecision(4))}</text></g>;
				})}
				{fields.map((field, series) => <g key={field}>
					<path d={linePath(samples.map((sample) => ({ x: x(sample), y: sample.values[field] === null ? null : y(sample.values[field]) })))} fill="none" stroke={colors[series]} strokeWidth="2" strokeDasharray={series ? "6 4" : undefined} vectorEffect="non-scaling-stroke" />
					{samples.map((sample, i) => sample.values[field] !== null && <circle key={`${sample.id}/${i}`} cx={x(sample)} cy={y(sample.values[field])} r="2" fill={colors[series]} />)}
				</g>)}
				{(size.width < 480 ? [0, samples.length - 1] : [0, Math.floor((samples.length - 1) / 2), samples.length - 1]).filter((tick, i, list) => list.indexOf(tick) === i).map((tick) => <text key={tick} x={x(samples[tick])} y={size.height - 7} textAnchor={tick === 0 ? "start" : tick === samples.length - 1 ? "end" : "middle"}>{displayTime(samples[tick].acquiredAt, true)}</text>)}
				{current && <line x1={x(current)} x2={x(current)} y1={top} y2={bottom} stroke="#94a3b8" strokeDasharray="3 4" />}
			</svg>
			{current && <div className="chart-tooltip" role="status" style={{ left: `${Math.min(size.width < 480 ? 25 : 65, Math.max(0, x(current) / size.width * 100))}%` }}><strong>{displayTime(current.acquiredAt, false, true)}</strong><span>记录 {current.id}</span>{fields.map((field) => <p key={field}>{displayFieldLabel(field)}<b>{displayValue(current.values[field])}</b></p>)}</div>}
		</div>
	</div>;
}
