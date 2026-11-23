/**
 * 端到端答案质量评测：对运行中的 DCMA 服务发送固定问题，按评分点检查流式回答与工具步骤。
 * 需要已启动的 web 服务和真实模型授权；不写入 Git，产出保存在 .dcma-runtime/acceptance/ 下。
 *
 * 运行（仓库根目录，先启动 `npm run web:dev`）：
 *   node --import ./packages/coding-agent/src/experimental/source-resolver.ts packages/web/answer-evaluation.ts
 * 可用环境变量：DCMA_EVAL_URL（默认 http://127.0.0.1:${DCMA_PORT:-3000}）、DCMA_EVAL_MODEL。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

interface Step {
	tool: string;
	ok: boolean;
	error?: string;
}
interface Outcome {
	question: string;
	table: string;
	answer: string;
	steps: Step[];
	charts: number;
	usage: { input: number; output: number; cost: number };
	failures: string[];
}

const baseUrl = process.env.DCMA_EVAL_URL ?? `http://127.0.0.1:${process.env.DCMA_PORT ?? 3000}`;
const model = process.env.DCMA_EVAL_MODEL ?? "deepseek/deepseek-flash";
const answers: Outcome[] = [];

async function ask(question: string, table: string): Promise<Outcome> {
	const outcome: Outcome = { question, table, answer: "", steps: [], charts: 0, usage: { input: 0, output: 0, cost: 0 }, failures: [] };
	const response = await fetch(`${baseUrl}/api/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-DCMA-Client": "web" },
		body: JSON.stringify({
			requestId: randomUUID(),
			model,
			text: question,
			context: JSON.stringify({ schema: "dcma", table, device: table, source: table === "real_data" ? "历史真实采集" : "模拟数据" }),
			database: true,
			table,
			history: [],
		}),
	});
	if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "")}`);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			const event = JSON.parse(line) as Record<string, unknown>;
			if (event.type === "delta") outcome.answer += String(event.text);
			else if (event.type === "tool_end")
				outcome.steps.push({
					tool: String(event.tool),
					ok: event.ok === true,
					...(typeof event.error === "string" && event.error ? { error: event.error } : {}),
				});
			else if (event.type === "chart") outcome.charts++;
			else if (event.type === "usage")
				outcome.usage = {
					input: outcome.usage.input + Number(event.input ?? 0),
					output: outcome.usage.output + Number(event.output ?? 0),
					cost: outcome.usage.cost + Number(event.cost ?? 0),
				};
			else if (event.type === "error") outcome.failures.push(`流错误：${event.message}`);
		}
		if (done) break;
	}
	return outcome;
}

const dataTools = new Set(["read_industrial_rows", "summarize_metrics", "get_code_events", "build_diagnostic_evidence", "read_industrial_dashboard", "analyze_threshold_events", "check_data_quality"]);

interface Rubric {
	minCharts?: number;
	must?: (RegExp | string)[];
	none?: (RegExp | string)[];
	steps?: { some: string[] }[];
}
const cases: { question: string; table: string; rubric: Rubric }[] = [
	{
		question: "sim_normal这台电机最近1小时运行得怎么样？",
		table: "sim_normal",
		rubric: {
			must: [/运行/, /结论|平稳|波动|状态/],
			none: [/(°C\)|\(A\)|\(r\/min\))/, /📌|💡/, /未按规则判定设备状态/, /本次完整分析未通过交付校验/],
			steps: [{ some: ["assess_device_state", "build_diagnostic_evidence"] }],
		},
	},
	{
		question: "sim_f07900_blocked最近2小时发生了什么？请分析堵转过程并给一张转矩趋势图。",
		table: "sim_f07900_blocked",
		rubric: {
			must: [/F07900/, /堵转/, /候选|可能原因|待验证/, /建议|核查|检查/],
			none: [/📌|💡/, /本次完整分析未通过交付校验/],
			steps: [{ some: ["get_code_events", "build_diagnostic_evidence"] }],
		},
	},
	{
		question: "G120 电机堵转 F07900 是什么原因？应该先检查什么？",
		table: "sim_f07900_blocked",
		rubric: {
			must: [/F07900/, /S120/, /适用|参考|系列|核对现场型号/],
			none: [/含义未确认/, /本次完整分析未通过交付校验/],
			steps: [{ some: ["search_fault_knowledge", "lookup_fault_code"] }],
		},
	},
	{
		question: "real_data_01这台电机最近1小时运行得怎么样？有报警吗？",
		table: "real_data_01",
		rubric: {
			must: [/运行/, /A07089|报警/, /观测|规则/],
			none: [/(本机维护手册资料源未配置|含义未确认（本机)/, /📌|💡/],
			steps: [{ some: ["assess_device_state", "build_diagnostic_evidence"] }],
		},
	},
	{
		question: "生成sim_normal最近一周的运行报告。",
		table: "sim_normal",
		rubric: {
			must: [/运行分析报告|结论|摘要/, /汇总|每小时|每.*小时/],
			none: [/📌|💡/, /本次完整分析未通过交付校验/],
			steps: [{ some: ["summarize_metrics", "build_diagnostic_evidence"] }],
		},
	},
	{
		question: "先别查数据。告诉我判断这台电机是否过热，你还缺哪些条件？",
		table: "sim_normal",
		rubric: {
			none: [/summarize_metrics/],
			steps: [{ some: ["（无数据工具）"] }],
		},
	},
	{
		question: "对比sim_normal最近1小时和前1小时的电机温度。",
		table: "sim_normal",
		rubric: {
			must: [/均值由/],
			none: [/混用了设备/, /本次完整分析未通过交付校验/],
			steps: [{ some: ["compare_metric_windows"] }],
		},
	},
	{
		question: "给sim_f07011_overtemp最近30分钟的电机温度画一张折线图。",
		table: "sim_f07011_overtemp",
		rubric: {
			minCharts: 1,
			must: [/温度/],
			none: [/该证据不含可绘图数据/, /本次完整分析未通过交付校验/],
			steps: [{ some: ["create_analysis_chart"] }],
		},
	},
];

function failed(outcome: Outcome, rubric: Rubric): string[] {
	const failures: string[] = [];
	const text = outcome.answer;
	// 数值精度按有效数字检查：小数位多但有效数字不超过5位（如0.02513）是合理的。
	for (const match of text.matchAll(/\d+\.\d+/gu)) {
		const digits = match[0].replace(".", "").replace(/^0+/, "");
		if (digits.length > 5) failures.push(`有效数字超过5位：${match[0]}`);
	}
	const check = (list: (RegExp | string)[] | undefined, kind: string) => {
		for (const item of list ?? []) {
			const hit = typeof item === "string" ? text.includes(item) : item.test(text);
			if (kind === "must" ? !hit : hit) failures.push(`${kind === "must" ? "缺少" : "不应出现"}：${item}`);
		}
	};
	check(rubric.must, "must");
	check(rubric.none, "none");
	if (rubric.minCharts && outcome.charts < rubric.minCharts) failures.push(`图表少于${rubric.minCharts}张`);
	const tools = new Set(outcome.steps.map((step) => step.tool));
	for (const requirement of rubric.steps ?? []) {
		if (requirement.some[0] === "（无数据工具）") {
			if (outcome.steps.some((step) => dataTools.has(step.tool))) failures.push("澄清问题不应调用数据工具");
			continue;
		}
		if (!requirement.some.some((tool) => tools.has(tool))) failures.push(`缺少工具调用：${requirement.some.join("/")}`);
	}
	// 模型对单次失败自行修正后继续成功，不算失败；只有该工具最后一次调用仍失败才计。
	const lastByTool = new Map<string, Step>();
	for (const step of outcome.steps) lastByTool.set(step.tool, step);
	for (const [tool, step] of lastByTool)
		if (!step.ok && tool !== "load_skill") failures.push(`工具失败：${tool}${step.error ? `（${step.error}）` : ""}`);
	if (!outcome.answer.trim()) failures.push("回答为空");
	return failures;
}

const started = Date.now();
for (const item of cases) {
	const outcome = await ask(item.question, item.table).catch((error: unknown) => ({
		question: item.question,
		table: item.table,
		answer: "",
		steps: [],
		charts: 0,
		usage: { input: 0, output: 0, cost: 0 },
		failures: [`请求异常：${error instanceof Error ? error.message : String(error)}`],
	}));
	const failures = [...outcome.failures, ...failed(outcome, item.rubric)];
	answers.push({ ...outcome, failures });
	const status = failures.length ? "FAIL" : "PASS";
	console.log(`${status} | ${item.question}`);
	for (const failure of failures) console.log(`   - ${failure}`);
}
const folder = new URL("./.dcma-runtime/acceptance/answer-eval/", import.meta.url).pathname;
await mkdir(folder, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(`${folder}/${stamp}.json`, JSON.stringify({ model, baseUrl, elapsedMs: Date.now() - started, answers }, null, 2));
const passed = answers.filter((item) => !item.failures.length).length;
console.log(`\n${passed}/${answers.length} 通过；耗时 ${Math.round((Date.now() - started) / 1000)} 秒，费用约 $${answers.reduce((sum, item) => sum + item.usage.cost, 0).toFixed(4)}。`);
console.log(`原始记录：${folder}/${stamp}.json`);
if (passed < answers.length) process.exitCode = 1;
