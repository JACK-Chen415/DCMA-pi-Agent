import { Check, ChevronDown, Globe, Paperclip, Send, Square } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { defaultWebKeybindings } from "../keyboard.ts";
import type { ToolId } from "../types.ts";
export function ChatInput({
	onSendMessage,
	disabled,
	onStop,
	onImport,
	enabledTools,
	onToggleTool,
}: {
	onSendMessage: (text: string) => void;
	disabled: boolean;
	onStop: () => void;
	onImport: () => void;
	enabledTools: ToolId[];
	onToggleTool: (tool: ToolId) => void;
}) {
	const [value, setValue] = useState("");
	const [showTools, setShowTools] = useState(false);
	const composing = useRef(false);
	const send = () => {
		if (!value.trim() || disabled) return;
		onSendMessage(value.trim());
		setValue("");
	};
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === defaultWebKeybindings.submit &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing &&
			!composing.current
		) {
			event.preventDefault();
			send();
		}
	};
	return (
		<div className="shrink-0 px-3 sm:px-6 pb-4 pt-2">
			<div className="relative max-w-[800px] mx-auto">
				{showTools && (
					<>
						<button
							type="button"
							aria-label="关闭工具菜单"
							onClick={() => setShowTools(false)}
							className="fixed inset-0 z-30 cursor-default"
						/>
						<fieldset
							className="absolute bottom-full mb-3 right-0 w-72 max-w-full panel-card z-40"
							aria-label="诊断工具箱"
						>
							<p className="text-xs font-bold mb-2">诊断工具箱 · 已启用 {enabledTools.length}/4</p>
							{(
								[
									["scada_telemetry", "监测数据分析", "读取当前设备的导入或示例数据"],
									["fault_kb", "通用故障排查", "通用检查步骤，未连接厂家知识库"],
									["pi_agent_harness", "Pi Agent 模型", "使用后端已授权的模型"],
									["auto_report", "分析报告导出", "下载 Markdown 分析报告"],
								] as [ToolId, string, string][]
							).map(([id, name, desc]) => (
								<button
									type="button"
									aria-pressed={enabledTools.includes(id)}
									key={id}
									onClick={() => onToggleTool(id)}
									className="text-left flex items-center justify-between gap-2 w-full p-2 hover:bg-slate-50 rounded-xl"
								>
									<span>
										<strong className="text-xs">{name}</strong>
										<span className="block text-[10px] text-slate-500">{desc}</span>
									</span>
									<span
										className={`w-4 h-4 rounded border flex items-center justify-center ${enabledTools.includes(id) ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300"}`}
									>
										{enabledTools.includes(id) && <Check className="w-3 h-3" />}
									</span>
								</button>
							))}
						</fieldset>
					</>
				)}
				<div className="bg-white border border-slate-200 rounded-2xl p-2 flex gap-1 items-end shadow-sm focus-within:border-blue-400">
					<button
						type="button"
						onClick={onImport}
						aria-label="上传遥测日志或设备档案 (CSV/LOG)"
						className="shrink-0 p-2 text-slate-500 hover:bg-blue-50 rounded-xl"
					>
						<Paperclip className="w-4 h-4" />
					</button>
					<textarea
						aria-label="问题输入"
						value={value}
						maxLength={8000}
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={onKeyDown}
						onCompositionStart={() => {
							composing.current = true;
						}}
						onCompositionEnd={() => {
							composing.current = false;
						}}
						disabled={disabled}
						placeholder="输入问题，Enter 发送，Shift+Enter 换行…"
						rows={2}
						className="min-w-0 flex-1 bg-transparent outline-none text-sm resize-none px-2 py-1 max-h-32 disabled:opacity-50"
					/>
					<button
						type="button"
						aria-expanded={showTools}
						aria-label="工具"
						onClick={() => setShowTools(!showTools)}
						className="shrink-0 p-2 flex items-center gap-1 text-xs text-slate-500 rounded-xl hover:bg-slate-50"
					>
						<Globe className="w-4 h-4" />
						<span className="hidden sm:inline">工具</span>
						<ChevronDown className="w-3 h-3" />
					</button>
					{disabled ? (
						<button
							type="button"
							aria-label="停止生成"
							onClick={onStop}
							className="p-2 bg-red-50 text-red-600 rounded-xl"
						>
							<Square className="w-4 h-4" />
						</button>
					) : (
						<button
							type="button"
							aria-label="发送问题"
							disabled={!value.trim()}
							onClick={send}
							className="p-2 bg-blue-600 text-white rounded-xl disabled:opacity-40"
						>
							<Send className="w-4 h-4" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
