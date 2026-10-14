import { useId } from "react";
import { displayValue, sampleRange } from "../dashboard-view.ts";

export function Gauge({ label, unit, value, samples, range: fixedRange }: { label: string; unit: string; value: number | null; samples: (number | null)[]; range?: { min: number; max: number } }) {
	const titleId = useId();
	const range = fixedRange ?? sampleRange(samples);
	const outside = value !== null && range ? value < range.min ? "低于显示量程" : value > range.max ? "高于显示量程" : "" : "";
	const ratio = value !== null && range ? Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min))) : null;
	const point = (fraction: number, radius: number) => ({ x: 100 - Math.cos(fraction * Math.PI) * radius, y: 96 - Math.sin(fraction * Math.PI) * radius });
	const tip = point(ratio ?? 0, 57);
	return <article className="panel-card gauge-card" data-outside-range={outside ? "true" : undefined}>
		<h3>{label}（{unit}）</h3>
		<svg viewBox="0 0 200 112" role="img" aria-labelledby={titleId}>
			<title id={titleId}>{label}：{displayValue(value)} {unit}。{range ? `${fixedRange ? "量程" : "采样范围"} ${displayValue(range.min)} 至 ${displayValue(range.max)} ${unit}` : "暂无有效采样范围"}{outside ? `。${outside}，指针停在边界，数值保留实际读数` : ""}</title>
			<path d="M 24 96 A 76 76 0 0 1 176 96" fill="none" stroke="#e8eef8" strokeWidth="12" strokeLinecap="round" />
			{ratio !== null && <path d="M 24 96 A 76 76 0 0 1 176 96" fill="none" stroke="#2563eb" strokeWidth="12" strokeLinecap="round" pathLength="1" strokeDasharray={`${ratio} 1`} />}
			{range && [0, .25, .5, .75, 1].map((fraction) => {
				const start = point(fraction, 64);
				const end = point(fraction, 69);
				return <line key={fraction} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#94a3b8" strokeWidth="1.5" />;
			})}
			{ratio !== null && <><line x1="100" y1="96" x2={tip.x} y2={tip.y} stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="96" r="5" fill="#1d4ed8" /></>}
			{range && <><text x="100" y="52" textAnchor="middle">{displayValue((range.min + range.max) / 2)}</text><text x="14" y="111">{displayValue(range.min)}</text><text x="186" y="111" textAnchor="end">{displayValue(range.max)}</text></>}
		</svg>
		<strong className="gauge-value">{displayValue(value)}</strong>
		{(outside || (!fixedRange && range)) && <span className="gauge-display-note" title={outside ? "显示量程不代表额定值或报警阈值" : "刻度来自当前采样窗口，不表示额定值或安全范围"}>{outside || "动态刻度"}</span>}
	</article>;
}
