import { ChevronRight, Download, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { type EvidenceBundle, type EvidenceRecord, toolLabels } from "../../interaction-contracts.ts";
import { type ExportResult, exportResultMessage, saveExportFile } from "../download.ts";
import { evidenceSections, loadEvidence } from "../evidence.ts";
import { completeMessageReport } from "../report.ts";
import type { ChatMessage } from "../types.ts";

function EvidenceContent({
	record,
	message,
	records,
}: {
	record: EvidenceRecord;
	message: ChatMessage;
	records: EvidenceRecord[];
}) {
	const sections = evidenceSections(record);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState("");
	const [exportResult, setExportResult] = useState<ExportResult | null>(null);
	const isReport = record.tool === "export_analysis_report";
	const result = record.result && typeof record.result === "object" ? (record.result as Record<string, unknown>) : {};
	const reportSources =
		isReport && Array.isArray(result.evidenceIds)
			? records.filter((item) => (result.evidenceIds as unknown[]).includes(item.id))
			: [];
	const download = async () => {
		setSaving(true);
		setSaveError("");
		setExportResult(null);
		try {
			setExportResult(
				await saveExportFile(
					`DCMA-analysis-${message.id}.html`,
					new Blob([await completeMessageReport(message)], { type: "text/html;charset=utf-8" }),
				),
			);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "报告保存失败，请重试。");
		} finally {
			setSaving(false);
		}
	};
	const notes = sections.flatMap((section) =>
		section.notes.map((note) => `${section.title ? `${section.title}：` : ""}${note}`),
	);
	return (
		<>
			{!sections.length && <p>本步骤的结果已保存。</p>}
			{sections.map((section) => (
				<section className="evidence-section" key={section.id}>
					{section.title && <h4>{section.title}</h4>}
					{!!section.facts.length && (
						<dl className="evidence-facts">
							{section.facts.map((fact) => (
								<div
									key={fact.label}
									data-wide={
										fact.label !== "覆盖采样" &&
										fact.label !== "统计范围" &&
										fact.label !== "图表数据" &&
										fact.label !== "来源采样"
									}
								>
									<dt>{fact.label}</dt>
									<dd>{fact.value}</dd>
								</div>
							))}
						</dl>
					)}
					{section.warnings.map((warning) => (
						<p className="evidence-warning" key={warning}>
							{warning}
						</p>
					))}
					{!!section.metrics.length && (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the statistics table.
						<section className="evidence-table-scroll" aria-label="指标统计，可横向滚动" tabIndex={0}>
							<table>
								<caption>{section.title ? `${section.title} · ` : ""}指标统计</caption>
								<thead>
									<tr>
										<th scope="col">指标 / 单位</th>
										<th scope="col">均值</th>
										<th scope="col">最小值</th>
										<th scope="col">最大值</th>
										<th scope="col">有效采样</th>
										<th scope="col">缺失</th>
									</tr>
								</thead>
								<tbody>
									{section.metrics.map((metric) => (
										<tr key={metric.label}>
											<th scope="row">
												{metric.label}
												<small>{metric.unit}</small>
											</th>
											<td className="evidence-mean">{metric.mean}</td>
											<td>{metric.min}</td>
											<td>{metric.max}</td>
											<td>{metric.count}</td>
											<td>{metric.missing}</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					)}
				</section>
			))}
			{isReport && (
				<div className="evidence-report">
					{!!reportSources.length && (
						<p>已包含：{[...new Set(reportSources.map((item) => toolLabels[item.tool]))].join("、")}。</p>
					)}
					<p>下载后可直接在浏览器中阅读，包含本次回答、图表及已取得的查询结果和参考资料。</p>
					<button type="button" disabled={saving || message.status !== "done"} onClick={() => void download()}>
						<Download size={14} aria-hidden="true" />
						{saving ? "正在整理报告…" : message.status === "done" ? "下载阅读版报告" : "回答完成后可下载报告"}
					</button>
					{exportResult && <output>{exportResultMessage(exportResult)}</output>}
					{saveError && <p role="alert">{saveError}</p>}
				</div>
			)}
			{!!notes.length && (
				<details className="evidence-disclosure">
					<summary>计算说明与资料</summary>
					{[...new Set(notes)].map((note) => (
						<p key={note}>{note}</p>
					))}
				</details>
			)}
			<p className="evidence-recorded">
				记录于 {new Date(record.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}
				（北京时间）
			</p>
		</>
	);
}

export function ExecutionDetails({ message }: { message: ChatMessage }) {
	const [open, setOpen] = useState(false);
	const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
	const [error, setError] = useState("");
	const [attempt, setAttempt] = useState(0);
	const [elapsed, setElapsed] = useState(0);
	const streaming = message.status === "streaming";
	const steps = message.steps ?? [];
	const running = steps.findLast((step) => step.status === "running");
	const evidenceIds = steps.flatMap((step) => (step.evidenceId ? [step.evidenceId] : [])).join(",");
	useEffect(() => {
		if (!streaming) return;
		const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(message.timestamp)) / 1000)));
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [streaming, message.timestamp]);
	useEffect(() => {
		if (!open || !evidenceIds) return;
		if (attempt > 0) setBundle(null);
		const controller = new AbortController();
		setError("");
		void loadEvidence(message.id, controller.signal)
			.then(setBundle)
			.catch((failure: unknown) => {
				if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "证据读取失败。");
			});
		return () => controller.abort();
	}, [open, evidenceIds, message.id, attempt]);
	if (!streaming && !steps.length) return null;
	return (
		<div className="execution-details">
			{streaming && (
				<output className="execution-progress" aria-live="polite">
					{running
						? `正在${toolLabels[running.tool]}…`
						: steps.length
							? "正在整理分析结果…"
							: message.content
								? "正在生成回答…"
								: "正在思考…"}
					<span aria-hidden="true"> · {elapsed} 秒</span>
					{elapsed >= 45 && <span className="block">处理时间较长，已取得的内容会保留，也可以停止生成。</span>}
				</output>
			)}
			{!!steps.length && (
				<details className="execution-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
					<summary className="execution-panel-heading">
						<ListChecks size={17} aria-hidden="true" />
						<strong>处理步骤与查询证据</strong>
						<span>
							{steps.length} 项 ·{" "}
							{steps.every((step) => step.status === "done")
								? "已完成"
								: `${steps.filter((step) => step.status === "done").length} 项完成`}
						</span>
						<ChevronRight size={16} className="execution-chevron" aria-hidden="true" />
					</summary>
					{error && (
						<p role="alert" className="evidence-warning">
							{error}{" "}
							<button type="button" onClick={() => setAttempt((value) => value + 1)}>
								重试读取
							</button>
						</p>
					)}
					<ol className="execution-steps">
						{steps.map((step, index) => {
							const record = bundle?.records.find((item) => item.id === step.evidenceId);
							return (
								<li key={step.callId}>
									<div className="execution-step-heading">
										<span className="execution-step-number" aria-hidden="true">
											{index + 1}
										</span>
										<strong>{toolLabels[step.tool]}</strong>
										<span
											className="execution-step-status"
											data-status={step.status === "running" && !streaming ? "interrupted" : step.status}
											title={step.error}
										>
											{step.status === "error"
												? "未成功"
												: step.status === "done"
													? "已完成"
													: streaming
														? "处理中"
														: "已中断"}
										</span>
										{step.durationMs !== undefined && (
											<span className="execution-duration">
												{step.durationMs < 100 ? "< 0.1" : (step.durationMs / 1000).toFixed(1)} 秒
											</span>
										)}
									</div>
									{step.error && <p className="evidence-warning">失败原因：{step.error}</p>}
									{step.evidenceId && !record && !error && <p>正在读取已保存的查询证据…</p>}
									{record && (
										<EvidenceContent record={record} message={message} records={bundle?.records ?? []} />
									)}
								</li>
							);
						})}
					</ol>
					<p className="evidence-footnote">展示查询当时的快照，不会重新查询。资料适用性和故障根因仍需确认。</p>
				</details>
			)}
		</div>
	);
}
