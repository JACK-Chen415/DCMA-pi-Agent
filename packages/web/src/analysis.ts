import { statusLabels } from "./mockData.ts";
import { getChartPoints, getMetrics } from "./telemetry.ts";
import type { AppSettings, ChatMessage, Dataset, Device } from "./types.ts";

export function analyzeLocally(
	text: string,
	device: Device,
	dataset: Dataset,
	settings: AppSettings,
): Pick<ChatMessage, "content" | "structuredData" | "engine"> {
	const threshold = Number(
		text.match(/(?:超过|高于|阈值[为是:：]?)[\s]*(\d+(?:\.\d+)?)\s*(?:℃|°C|度)/iu)?.[1] ?? settings.alarmThreshold,
	);
	const dates = [...text.matchAll(/\d{4}-\d{2}-\d{2}/gu)].map((match) => match[0]);
	const start = dates[0] ? Date.parse(`${dates[0]}T00:00:00`) : -Infinity;
	const end = dates[1] ? Date.parse(`${dates[1]}T23:59:59.999`) : Infinity;
	if (!Number.isFinite(threshold) || threshold < -100 || threshold > 1000)
		throw new Error("温度阈值需要在 -100 至 1000 ℃ 之间。");
	if (Number.isNaN(start) || Number.isNaN(end) || start > end)
		throw new Error("日期区间无效，请使用 YYYY-MM-DD 至 YYYY-MM-DD。");
	const enabled = settings.enabledTools.includes("scada_telemetry");
	const samples = enabled
		? dataset.samples.filter((sample) => Date.parse(sample.timestamp) >= start && Date.parse(sample.timestamp) <= end)
		: [];
	const temperatures = samples.flatMap((sample) => (sample.temperature === undefined ? [] : [sample.temperature]));
	let events = 0;
	let above = false;
	for (const sample of samples) {
		const next = sample.temperature !== undefined && sample.temperature > threshold;
		if (next && !above) events++;
		above = next;
	}
	const count = temperatures.filter((value) => value > threshold).length;
	const metrics = getMetrics(samples, threshold);
	const source = enabled ? dataset.source : "监测数据工具已关闭";
	const sections = [
		`设备：${device.name}（${device.code}）\n类型：${device.type}\n位置：${device.location}\n投运时间：${device.commissionDate}\n台账状态：${statusLabels[device.status]}\n数据来源：${source}`,
	];
	if (!enabled) sections.push("未启用监测数据工具。请在工具菜单中启用后进行温度统计与图表分析。");
	else if (!samples.length)
		sections.push("所选区间没有采样数据，无法生成统计或判断设备健康状态。请导入对应区间的数据。");
	else {
		sections.push(
			`数据区间：${new Date(samples[0].timestamp).toLocaleString("zh-CN")} 至 ${new Date(samples.at(-1)!.timestamp).toLocaleString("zh-CN")}\n采样点总数：${samples.length}\n最新采样值：${metrics.map((metric) => `${metric.label} ${metric.value} ${metric.unit}`).join("；")}`,
		);
		if (temperatures.length)
			sections.push(
				`温度阈值：${threshold} ℃\n高于阈值的采样点：${count} / ${temperatures.length}\n连续超温事件：${events} 次（连续的超阈值采样点计作一次事件；缺失值中断事件）\n最高温度：${Math.max(...temperatures).toFixed(2)} ℃\n平均温度：${(temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length).toFixed(2)} ℃`,
			);
		else sections.push("当前数据没有温度列，不能统计超温事件。");
	}
	const recommendations: string[] = [];
	if (count > 0)
		recommendations.push(
			"存在高于当前配置阈值的温度采样点。核对传感器、设备额定限值、负荷与冷却记录后再确认是否属于设备异常。",
		);
	if (/故障|过载|故障码/iu.test(text)) {
		if (settings.enabledTools.includes("fault_kb")) {
			const code = text.match(/\b(?:F|E|AL)[-_]?\d{2,6}\b/iu)?.[0];
			sections.push(
				code
					? `故障码 ${code} 需结合设备厂商、型号与对应版本手册解释，当前未接入厂家故障码库，不能确认代码含义。`
					: "排查方向：记录报警时间和原始故障码，核对负荷、供电、机械阻力与冷却条件。当前数据无法确定根因或原因概率。",
			);
			recommendations.push("提供设备厂商、型号、故障码、报警前后数据及维护记录，逐项验证候选原因。");
		} else sections.push("故障排查工具已关闭，未生成故障排查建议。");
	}
	if (/维护|建议|报表/iu.test(text))
		recommendations.push(
			`按${device.type}的厂家维护手册核对点检项目；根据历史趋势安排传感器校验、冷却通道检查和记录复核。未提供大修记录与运行小时数，不能推定维护周期。`,
		);
	if (/报表|报告/iu.test(text) && !settings.enabledTools.includes("auto_report"))
		sections.push("报表导出工具已关闭。启用后可下载本次分析的 Markdown 报告。");
	if (dataset.imported)
		sections.push(
			"本结果为对导入文件的本地统计，未连接在线 SCADA。采样点之间的持续时间、设备健康评级及根因需额外证据。",
		);
	else sections.push("以上数值来自示例数据，仅用于演示界面与统计流程，不能作为现场诊断结论。");
	return {
		engine: "本地数据分析",
		content: sections.join("\n\n"),
		structuredData: {
			type: /维护/iu.test(text) ? "maintenance_plan" : /故障/iu.test(text) ? "fault_code" : "diagnostic_report",
			title: `${device.name}数据分析`,
			source,
			metrics: {
				采样点: String(samples.length),
				温度阈值: `${threshold} ℃`,
				超温采样点: String(count),
				连续超温事件: `${events} 次`,
			},
			chartData: getChartPoints(samples, "temperature"),
			chartLabel: "采样温度趋势（℃）",
			threshold,
			recommendations,
		},
	};
}

export function messageReport(message: ChatMessage): string {
	const data = message.structuredData;
	return `# ${data?.title ?? "DCMA 对话记录"}\n\n生成时间：${message.timestamp}\n分析引擎：${message.engine ?? "未指定"}\n\n${message.content}\n\n${
		data
			? `## 统计\n\n${Object.entries(data.metrics ?? {})
					.map(([name, value]) => `- ${name}：${value}`)
					.join(
						"\n",
					)}\n\n## 建议\n\n${(data.recommendations ?? []).map((text) => `- ${text}`).join("\n")}\n\n## 图表数据\n\n时间,温度\n${(data.chartData ?? []).map((point) => `${point.name},${point.value}`).join("\n")}\n`
			: ""
	}`;
}
