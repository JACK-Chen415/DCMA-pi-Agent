import { useId } from "react";
import type { ChartPoint } from "../types.ts";

export function LineChart({
	points,
	threshold,
	label,
	compact = false,
}: {
	points: ChartPoint[];
	threshold?: number;
	label: string;
	compact?: boolean;
}) {
	const titleId = useId();
	if (!points.length) return <p className="text-xs text-slate-500 py-4">暂无{label}数据</p>;
	// Keep both extremes in each bucket so short spikes survive display downsampling.
	const display: ChartPoint[] = [];
	const bucketSize = Math.max(1, Math.ceil(points.length / 250));
	for (let i = 0; i < points.length; i += bucketSize) {
		const bucket = points.slice(i, i + bucketSize);
		const low = bucket.reduce((a, b) => (a.value <= b.value ? a : b));
		const high = bucket.reduce((a, b) => (a.value >= b.value ? a : b));
		for (const point of bucket.filter((point) => point === low || point === high)) display.push(point);
	}
	if (display[0] !== points[0]) display.unshift(points[0]);
	if (display.at(-1) !== points.at(-1)) display.push(points.at(-1)!);
	const values = display.map((point) => point.value);
	if (threshold !== undefined) values.push(threshold);
	const low = Math.min(...values);
	const high = Math.max(...values);
	const padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.01, 0.01);
	const min = low - padding;
	const max = high + padding;
	const left = compact ? 0 : 50;
	const right = compact ? 400 : 390;
	const top = compact ? 0 : 12;
	const bottom = compact ? 100 : 145;
	const firstTime = points[0].time ?? 0;
	const lastTime = points.at(-1)?.time ?? points.length - 1;
	const x = (point: ChartPoint, index: number) =>
		left + (((point.time ?? index) - firstTime) / (lastTime - firstTime || 1)) * (right - left);
	const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
	const path = display
		.map((point, i) => `${i ? "L" : "M"}${x(point, i).toFixed(2)},${y(point.value).toFixed(2)}`)
		.join(" ");
	return (
		<div className={compact ? "h-5 w-full" : "w-full"}>
			<svg
				role="img"
				aria-labelledby={titleId}
				className={compact ? "h-full w-full" : "w-full h-40"}
				viewBox={compact ? "0 0 400 100" : "0 0 410 175"}
				preserveAspectRatio={compact ? "none" : "xMidYMid meet"}
			>
				<title id={titleId}>
					{label}，{points.length} 个采样点{threshold === undefined ? "" : `，阈值 ${threshold}`}
				</title>
				{!compact &&
					[0, 1, 2, 3].map((index) => {
						const value = min + ((max - min) * index) / 3;
						return (
							<g key={index}>
								<line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e2e8f0" />
								<text x="45" y={y(value) + 3} textAnchor="end" fontSize="9" fill="#64748b">
									{value.toPrecision(3)}
								</text>
							</g>
						);
					})}
				{threshold !== undefined && (
					<line x1={left} x2={right} y1={y(threshold)} y2={y(threshold)} stroke="#ef4444" strokeDasharray="5 4" />
				)}
				<path
					d={path}
					stroke="#2563eb"
					fill="none"
					strokeWidth={compact ? 1.5 : 2}
					vectorEffect="non-scaling-stroke"
				/>
				{points.length === 1 && <circle cx={x(points[0], 0)} cy={y(points[0].value)} r="3" fill="#2563eb" />}
				{!compact &&
					[0, Math.floor((points.length - 1) / 2), points.length - 1]
						.filter((index, i, list) => list.indexOf(index) === i)
						.map((index) => (
							<text
								key={index}
								x={x(points[index], index)}
								y="166"
								textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
								fontSize="8"
								fill="#64748b"
							>
								{points[index].name}
							</text>
						))}
			</svg>
		</div>
	);
}
