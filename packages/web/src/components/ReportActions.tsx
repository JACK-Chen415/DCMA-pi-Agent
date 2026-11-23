import { ChevronDown, Download, Eye, FileCode, FileText, FileType } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { renderReportPdf } from "../api.ts";
import { downloadText, type ExportResult, exportResultMessage, saveExportFile } from "../download.ts";
import { completeMessageMarkdown, completeMessageReport, messageReport } from "../report.ts";
import type { ChatMessage } from "../types.ts";
import { Modal } from "./Modal";
import { SpeakButton } from "./SpeakButton";

type Format = "md" | "pdf" | "html" | "preview";

export function ReportActions({ message, question }: { message: ChatMessage; question: string }) {
	const [busy, setBusy] = useState<Format | "">("");
	const [error, setError] = useState("");
	const [exportResult, setExportResult] = useState<ExportResult | null>(null);
	const [pinned, setPinned] = useState(false);
	const [direction, setDirection] = useState<"up" | "down">("up");
	const [preview, setPreview] = useState<{ name: string; html: string } | null>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const baseName = `DCMA-analysis-${message.id}`;
	useEffect(() => {
		const element = wrap.current;
		if (!element) return;
		// Keep the menu visible inside the scrolling transcript instead of clipping at the top edge.
		const update = () => setDirection(element.getBoundingClientRect().top < 320 ? "down" : "up");
		element.addEventListener("pointerenter", update);
		element.addEventListener("focusin", update);
		return () => {
			element.removeEventListener("pointerenter", update);
			element.removeEventListener("focusin", update);
		};
	}, []);
	useEffect(() => {
		if (!pinned) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setPinned(false);
		};
		const onPointer = (event: MouseEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest(".report-menu-wrap")) return;
			setPinned(false);
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("mousedown", onPointer);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("mousedown", onPointer);
		};
	}, [pinned]);

	const run = async (format: Format) => {
		setBusy(format);
		setError("");
		setExportResult(null);
		try {
			if (format === "preview") {
				setPreview({ name: baseName, html: await completeMessageReport(message, question) });
				return;
			}
			if (format === "md") {
				const markdown = await completeMessageMarkdown(message, question);
				setExportResult(
					await saveExportFile(`${baseName}.md`, new Blob([markdown], { type: "text/markdown;charset=utf-8" })),
				);
				return;
			}
			const html = await completeMessageReport(message, question);
			if (format === "html") {
				setExportResult(
					await saveExportFile(`${baseName}.html`, new Blob([html], { type: "text/html;charset=utf-8" })),
				);
				return;
			}
			setExportResult(await saveExportFile(`${baseName}.pdf`, await renderReportPdf(html)));
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "报告生成失败，请重试。");
		} finally {
			setBusy("");
		}
	};
	const choose = (format: Format) => {
		setPinned(false);
		void run(format);
	};
	const items: { format: Format; icon: typeof FileText; title: string; detail: string }[] = [
		{ format: "md", icon: FileText, title: ".md", detail: "Markdown 报告，含表格与证据" },
		{ format: "pdf", icon: FileType, title: "PDF", detail: "排版文件，适合打印与归档" },
		{ format: "html", icon: FileCode, title: "HTML", detail: "独立网页报告，当前样式" },
		{ format: "preview", icon: Eye, title: "预览", detail: "在页面内查看 HTML 报告" },
	];
	return (
		<>
			<div className="message-actions">
				<div className="report-menu-wrap" ref={wrap} data-pinned={pinned ? "true" : undefined}>
					<button
						type="button"
						aria-haspopup="menu"
						aria-expanded={pinned}
						disabled={busy !== ""}
						onClick={() => setPinned((value) => !value)}
					>
						<Download size={14} />
						{busy ? "正在生成报告…" : "下载完整报告"}
						<ChevronDown size={13} />
					</button>
					<div className="report-menu" role="menu" aria-label="报告导出格式" data-direction={direction}>
						{items.map((item) => {
							const Icon = item.icon;
							return (
								<button
									key={item.format}
									type="button"
									role="menuitem"
									disabled={busy !== ""}
									onClick={() => choose(item.format)}
								>
									<Icon size={15} />
									<span>
										<strong>{item.title}</strong>
										{item.detail}
									</span>
								</button>
							);
						})}
					</div>
				</div>
				<button
					type="button"
					disabled={busy !== ""}
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
			{preview && (
				<Modal
					title="报告预览"
					subtitle="HTML 报告实际排版；导出的 PDF 使用相同内容"
					size="wide"
					onClose={() => setPreview(null)}
				>
					<iframe
						className="report-preview-frame"
						title={`${preview.name} 报告预览`}
						srcDoc={preview.html}
						sandbox=""
					/>
				</Modal>
			)}
		</>
	);
}
