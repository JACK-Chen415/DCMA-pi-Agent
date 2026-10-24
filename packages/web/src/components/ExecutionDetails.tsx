import { useEffect, useState } from "react";
import { type EvidenceBundle, toolLabels } from "../../interaction-contracts.ts";
import { evidenceSummary, loadEvidence } from "../evidence.ts";
import type { ChatMessage } from "../types.ts";

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
				<details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
					<summary>处理步骤与查询证据 · {steps.length} 项</summary>
					{error && (
						<p role="alert">
							{error}{" "}
							<button type="button" onClick={() => setAttempt((value) => value + 1)}>
								重试读取
							</button>
						</p>
					)}
					<ol>
						{steps.map((step) => {
							const record = bundle?.records.find((item) => item.id === step.evidenceId);
							return (
								<li key={step.callId}>
									<div className="execution-step-heading">
										<strong>{toolLabels[step.tool]}</strong>
										<span>
											{step.status === "error"
												? "未成功"
												: step.status === "done"
													? "已完成"
													: streaming
														? "处理中"
														: "已中断"}
											{step.durationMs !== undefined ? ` · ${(step.durationMs / 1000).toFixed(1)} 秒` : ""}
										</span>
									</div>
									{step.evidenceId && !record && !error && <p>正在读取已保存的查询证据…</p>}
									{record && (
										<>
											<p>
												记录时间：
												{new Date(record.createdAt).toLocaleString("zh-CN", {
													timeZone: "Asia/Shanghai",
													hour12: false,
												})}
												（北京时间）
											</p>
											{evidenceSummary(record).map((line) => (
												<p key={line}>{line}</p>
											))}
											<details>
												<summary>查看查询条件与完整结果</summary>
												<pre>
													{JSON.stringify({ parameters: record.input, result: record.result }, null, 2)}
												</pre>
											</details>
										</>
									)}
								</li>
							);
						})}
					</ol>
					<p>证据保存查询当时的结果；资料适用性和故障根因仍需确认。</p>
				</details>
			)}
		</div>
	);
}
