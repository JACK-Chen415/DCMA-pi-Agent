import { Cpu, Download } from "lucide-react";
import { useEffect, useRef } from "react";
import { messageReport } from "../analysis.ts";
import { downloadText } from "../download.ts";
import type { ChatMessage } from "../types.ts";
import { LineChart } from "./LineChart";
export function ChatView({
	messages,
	isStreaming,
	canExport,
}: {
	messages: ChatMessage[];
	isStreaming: boolean;
	canExport: boolean;
}) {
	const bottom = useRef<HTMLDivElement>(null);
	const last = messages.at(-1);
	const scrollKey = `${messages.length}:${last?.id}:${last?.content.length}`;
	useEffect(() => {
		if (scrollKey) bottom.current?.scrollIntoView({ behavior: isStreaming ? "instant" : "smooth" });
	}, [scrollKey, isStreaming]);
	return (
		<div
			role="log"
			aria-label="对话消息"
			aria-busy={isStreaming}
			className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-5 w-full"
		>
			<div className="max-w-[800px] mx-auto space-y-5">
				{messages.map((message) => (
					<div
						key={message.id}
						className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
					>
						{message.role === "assistant" && (
							<span className="h-8 w-8 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center">
								<Cpu className="w-4 h-4" />
							</span>
						)}
						<article
							className={`min-w-0 max-w-[92%] sm:max-w-[88%] rounded-2xl p-4 ${message.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-slate-100"}`}
						>
							{message.role === "assistant" && (
								<p className="text-[11px] text-slate-500 border-b border-slate-100 pb-2 mb-2">
									{message.engine || "DCMA"} · {new Date(message.timestamp).toLocaleTimeString("zh-CN")}
								</p>
							)}
							<div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
								{message.content
									.split(/(\*\*[^*]+\*\*)/gu)
									.map((part, index) =>
										part.startsWith("**") && part.endsWith("**") ? (
											<strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>
										) : (
											part
										),
									)}
							</div>
							{message.structuredData && (
								<div className="mt-4 space-y-3 text-xs">
									<h3 className="font-bold">{message.structuredData.title}</h3>
									<p className="text-amber-700">{message.structuredData.source}</p>
									<dl className="grid grid-cols-2 gap-2">
										{Object.entries(message.structuredData.metrics ?? {}).map(([name, value]) => (
											<div key={name} className="bg-slate-50 rounded-xl p-2">
												<dt className="text-slate-500">{name}</dt>
												<dd className="font-semibold mt-1">{value}</dd>
											</div>
										))}
									</dl>
									{!!message.structuredData.chartData?.length && (
										<div className="bg-slate-50 rounded-xl p-2">
											<p>
												{message.structuredData.chartLabel} · 阈值 {message.structuredData.threshold} ℃
											</p>
											<LineChart
												points={message.structuredData.chartData}
												threshold={message.structuredData.threshold}
												label={message.structuredData.chartLabel ?? "温度"}
											/>
										</div>
									)}
									{!!message.structuredData.recommendations?.length && (
										<ul className="list-disc pl-5 bg-emerald-50 p-3 rounded-xl space-y-2">
											{message.structuredData.recommendations.map((text) => (
												<li key={text}>{text}</li>
											))}
										</ul>
									)}
								</div>
							)}
							{message.status === "streaming" && (
								<output className="block text-xs text-blue-600 mt-2 animate-pulse">正在生成…</output>
							)}
							{(message.status === "error" || message.status === "cancelled") && (
								<p className="text-xs text-red-600 mt-2">
									{message.status === "error" ? "本次请求失败，可重新发送" : "生成已停止"}
								</p>
							)}
							{message.role === "assistant" && message.status === "done" && canExport && (
								<button
									type="button"
									onClick={() =>
										downloadText(
											`DCMA-${message.id}.md`,
											messageReport(message),
											"text/markdown;charset=utf-8",
										)
									}
									className="mt-3 flex items-center gap-1 text-xs text-blue-600"
								>
									<Download className="w-3 h-3" />
									下载分析报告
								</button>
							)}
						</article>
					</div>
				))}
				<div ref={bottom} />
			</div>
		</div>
	);
}
