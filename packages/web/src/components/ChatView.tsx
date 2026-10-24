import { Cpu, User } from "lucide-react";
import { useEffect, useRef } from "react";
import { timeToSeconds } from "../time-display.ts";
import type { ChatMessage } from "../types.ts";
import { AnalysisChartCard } from "./AnalysisChartCard";
import { ExecutionDetails } from "./ExecutionDetails";
import { MessageContent } from "./MessageContent";
import { ReportActions } from "./ReportActions";
export function ChatView({
	messages,
	isStreaming,
	onRequery,
}: {
	messages: ChatMessage[];
	isStreaming: boolean;
	onRequery?: (text: string) => void;
}) {
	const bottom = useRef<HTMLDivElement>(null);
	const last = messages.at(-1);
	const scrollKey = `${messages.length}:${last?.id}:${last?.content.length}:${last?.charts?.length}`;
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
				{messages.map((message, index) => (
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
							className={`min-w-0 max-w-[92%] sm:max-w-[88%] rounded-2xl p-4 ${message.charts?.length ? "w-full" : ""} ${message.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-slate-100"}`}
						>
							{message.role === "assistant" && (
								<p className="text-[11px] text-slate-500 border-b border-slate-100 pb-2 mb-2">
									{message.engine || "DCMA"} · {new Date(message.timestamp).toLocaleTimeString("zh-CN")}
								</p>
							)}
							{message.role === "assistant" ? (
								<MessageContent content={message.content} />
							) : (
								<div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
									{timeToSeconds(message.content)}
								</div>
							)}
							{message.role === "assistant" && <ExecutionDetails message={message} />}
							{message.role === "assistant" &&
								message.charts?.map((chart) => (
									<AnalysisChartCard
										key={chart.id}
										reference={chart}
										onRequery={onRequery}
										disabled={isStreaming}
									/>
								))}
							{(message.status === "error" || message.status === "cancelled") && (
								<p className="text-xs text-red-600 mt-2">
									{message.status === "error" ? "本次请求失败，可重新发送" : "生成已停止"}
								</p>
							)}
							{message.role === "assistant" && message.status === "done" && (
								<ReportActions
									message={message}
									question={messages[index - 1]?.role === "user" ? messages[index - 1].content : ""}
								/>
							)}
						</article>
						{message.role === "user" && (
							<span
								role="img"
								aria-label="用户头像"
								className="h-8 w-8 shrink-0 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center"
							>
								<User className="w-4 h-4" aria-hidden="true" />
							</span>
						)}
					</div>
				))}
				<div ref={bottom} />
			</div>
		</div>
	);
}
