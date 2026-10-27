import { Download } from "lucide-react";
import { useState } from "react";
import { downloadText, type ExportResult, exportResultMessage, saveExportFile } from "../download.ts";
import { completeMessageReport, messageReport } from "../report.ts";
import type { ChatMessage } from "../types.ts";
import { SpeakButton } from "./SpeakButton";

export function ReportActions({ message, question }: { message: ChatMessage; question: string }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [exportResult, setExportResult] = useState<ExportResult | null>(null);
	const download = async () => {
		setBusy(true);
		setError("");
		setExportResult(null);
		try {
			setExportResult(
				await saveExportFile(
					`DCMA-analysis-${message.id}.html`,
					new Blob([await completeMessageReport(message, question)], { type: "text/html;charset=utf-8" }),
				),
			);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "报告生成失败，请重试。");
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<div className="message-actions">
				<button type="button" disabled={busy} onClick={() => void download()}>
					<Download size={14} />
					{busy ? "正在整理报告…" : "下载完整报告"}
				</button>
				<button
					type="button"
					onClick={() =>
						downloadText(`DCMA-${message.id}.md`, messageReport(message), "text/markdown;charset=utf-8")
					}
				>
					<Download size={14} />
					下载回答文字
				</button>
				<SpeakButton content={message.content} />
			</div>
			{exportResult && (
				<output className="block text-xs text-blue-700 mt-2 break-all">{exportResultMessage(exportResult)}</output>
			)}
			{error && (
				<p role="alert" className="text-xs text-red-700 mt-2">
					{error}
				</p>
			)}
		</>
	);
}
