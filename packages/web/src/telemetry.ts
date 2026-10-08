import type { ChartPoint, Dataset, MetricData, MetricKey, TelemetrySample } from "./types.ts";
export const metricDefinitions: { id: MetricKey; label: string; unit: string }[] = [
	{ id: "temperature", label: "温度", unit: "℃" },
	{ id: "vibration", label: "振动", unit: "mm/s" },
	{ id: "current", label: "电流", unit: "A" },
	{ id: "speed", label: "转速", unit: "rpm" },
];
export function getMetrics(samples: TelemetrySample[], threshold: number): MetricData[] {
	return metricDefinitions.map(({ id, label, unit }) => {
		const values = samples.flatMap((sample) => (sample[id] === undefined ? [] : [sample[id]!]));
		const value = samples.at(-1)?.[id];
		const previous = samples.at(-2)?.[id];
		const delta = value !== undefined && previous !== undefined ? value - previous : undefined;
		return {
			id,
			label,
			unit,
			value: value ?? "—",
			change: delta === undefined ? "无前值" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`,
			trend: delta === undefined || delta === 0 ? "flat" : delta > 0 ? "up" : "down",
			accentColor: id === "temperature" && value !== undefined && value > threshold ? "amber" : "blue",
			sparkline: values.slice(-24),
		};
	});
}
export function getChartPoints(samples: TelemetrySample[], key: MetricKey): ChartPoint[] {
	return samples.flatMap((sample) =>
		sample[key] === undefined
			? []
			: [
					{
						name: new Date(sample.timestamp).toLocaleString("zh-CN", {
							month: "2-digit",
							day: "2-digit",
							hour: "2-digit",
							minute: "2-digit",
							second: "2-digit",
						}),
						time: Date.parse(sample.timestamp),
						value: sample[key]!,
					},
				],
	);
}
function splitCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"') {
			if (quoted && text[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = !quoted;
		} else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
			row.push(field.trim());
			field = "";
			if (char !== ",") {
				if (row.some(Boolean)) rows.push(row);
				row = [];
				if (char === "\r" && text[i + 1] === "\n") i++;
			}
		} else field += char;
	}
	if (quoted) throw new Error("CSV 引号未闭合，请检查文件格式。");
	row.push(field.trim());
	if (row.some(Boolean)) rows.push(row);
	return rows;
}
const aliases: Record<string, keyof TelemetrySample> = {
	timestamp: "timestamp",
	time: "timestamp",
	date: "timestamp",
	时间: "timestamp",
	时间戳: "timestamp",
	temperature: "temperature",
	temp: "temperature",
	温度: "temperature",
	"温度(℃)": "temperature",
	vibration: "vibration",
	振动: "vibration",
	current: "current",
	电流: "current",
	speed: "speed",
	rpm: "speed",
	转速: "speed",
};
export function parseTelemetry(text: string, fileName: string): Dataset {
	const clean = text.replace(/^\uFEFF/u, "").trim();
	if (!clean) throw new Error("文件为空。");
	let records: Record<string, unknown>[];
	if (clean.startsWith("{")) {
		records = clean
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line, i) => {
				let value: unknown;
				try {
					value = JSON.parse(line);
				} catch {
					throw new Error(`LOG 第 ${i + 1} 行不是有效 JSON。`);
				}
				if (!value || typeof value !== "object" || Array.isArray(value))
					throw new Error(`LOG 第 ${i + 1} 行必须是对象。`);
				return value as Record<string, unknown>;
			});
	} else {
		const [headers, ...rows] = splitCsv(clean);
		if (!headers || rows.length === 0) throw new Error("CSV 需要列名及至少一行数据。");
		if (new Set(headers).size !== headers.length) throw new Error("CSV 存在重复列名。");
		records = rows.map((row, i) => {
			if (row.length !== headers.length) throw new Error(`CSV 第 ${i + 2} 行列数不匹配。`);
			return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
		});
	}
	if (records.length > 10000) throw new Error("最多支持 10000 个采样点，请拆分文件。");
	const samples = records
		.map((record, i): TelemetrySample => {
			const normalized: Record<string, unknown> = {};
			for (const [name, value] of Object.entries(record)) {
				const key = aliases[name.trim().toLowerCase()];
				if (key) normalized[key] = value;
			}
			const rawTime = normalized.timestamp;
			const datePart = typeof rawTime === "string" ? rawTime.trim().slice(0, 10) : "";
			const calendarDate = new Date(`${datePart}T00:00:00Z`);
			if (
				typeof rawTime !== "string" ||
				!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/u.test(rawTime.trim()) ||
				!Number.isFinite(Date.parse(rawTime)) ||
				!Number.isFinite(calendarDate.getTime()) ||
				calendarDate.toISOString().slice(0, 10) !== datePart
			)
				throw new Error(`数据第 ${i + 1} 行缺少有效时间 timestamp。`);
			const sample: TelemetrySample = { timestamp: new Date(rawTime).toISOString() };
			for (const { id } of metricDefinitions) {
				const raw = normalized[id];
				if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) continue;
				if (typeof raw !== "number" && typeof raw !== "string")
					throw new Error(`数据第 ${i + 1} 行的 ${id} 不是数值。`);
				const value = Number(raw);
				if (!Number.isFinite(value)) throw new Error(`数据第 ${i + 1} 行的 ${id} 不是有限数值。`);
				sample[id] = value;
			}
			if (Object.keys(sample).length === 1) throw new Error(`数据第 ${i + 1} 行缺少温度、振动、电流或转速。`);
			return sample;
		})
		.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
	if (new Set(samples.map((sample) => sample.timestamp)).size !== samples.length)
		throw new Error("时间戳重复，请先合并或删除重复采样点。");
	return { source: `导入文件：${fileName}`, imported: true, samples };
}
export function telemetryCsv(samples: TelemetrySample[]): string {
	return `timestamp,temperature,vibration,current,speed\n${samples.map((sample) => [sample.timestamp, ...metricDefinitions.map(({ id }) => sample[id] ?? "")].join(",")).join("\n")}\n`;
}
export function getSpectrum(samples: TelemetrySample[]): { points: ChartPoint[]; message: string } {
	const values = samples.slice(-256);
	if (values.length < 4 || values.some((sample) => sample.vibration === undefined))
		return { points: [], message: "振动频谱需要至少 4 个连续振动采样点。" };
	const intervals = values.slice(1).map((sample, i) => Date.parse(sample.timestamp) - Date.parse(values[i].timestamp));
	const interval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
	if (interval <= 0 || intervals.some((value) => Math.abs(value - interval) > interval * 0.05))
		return { points: [], message: "时间间隔不规则，不能直接计算频谱；请导入等间隔振动波形。" };
	const mean = values.reduce((sum, sample) => sum + sample.vibration!, 0) / values.length;
	const points = Array.from({ length: Math.floor(values.length / 2) }, (_, k) => {
		const bin = k + 1;
		let real = 0;
		let imaginary = 0;
		values.forEach((sample, i) => {
			const angle = (2 * Math.PI * bin * i) / values.length;
			const value = sample.vibration! - mean;
			real += value * Math.cos(angle);
			imaginary -= value * Math.sin(angle);
		});
		const frequency = (bin * 1000) / interval / values.length;
		return {
			name: `${frequency.toPrecision(3)} Hz`,
			time: frequency,
			value: ((bin * 2 === values.length ? 1 : 2) * Math.hypot(real, imaginary)) / values.length,
		};
	});
	return {
		points,
		message: `采样率 ${(1000 / interval).toPrecision(4)} Hz；${values.length} 点离散傅里叶变换，去除直流分量。仅解释奈奎斯特频率以下的频率成分。`,
	};
}
