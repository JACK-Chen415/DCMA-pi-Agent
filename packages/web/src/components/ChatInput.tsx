import { Mic, Paperclip, Send, Square } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { defaultWebKeybindings } from "../keyboard.ts";
import { checkMicrophoneAccess, startVoiceInput, voiceInputAvailable } from "../speech.ts";
import { ColumnResizer } from "./ColumnResizer";
export function ChatInput({
	onSendMessage,
	disabled,
	onStop,
	onImport,
	model,
	models,
	onSelectModel,
	columnWidth,
	columnMaxWidth,
	showColumnResizer,
	onColumnWidthChange,
	onColumnWidthReset,
}: {
	onSendMessage: (text: string) => void;
	disabled: boolean;
	onStop?: () => void;
	onImport: () => void;
	model: string;
	models: { id: string; name: string }[];
	onSelectModel: (id: string) => void;
	columnWidth: number;
	columnMaxWidth: number;
	showColumnResizer: boolean;
	onColumnWidthChange: (next: number) => void;
	onColumnWidthReset: () => void;
}) {
	const [value, setValue] = useState("");
	const [listening, setListening] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const [voiceError, setVoiceError] = useState("");
	const recognition = useRef<ReturnType<typeof startVoiceInput> | null>(null);
	const voiceAttempt = useRef(0);
	const voiceAvailable = voiceInputAvailable();
	useEffect(
		() => () => {
			voiceAttempt.current++;
			recognition.current?.dispose();
		},
		[],
	);
	useEffect(() => {
		if (disabled) {
			voiceAttempt.current++;
			recognition.current?.dispose();
			recognition.current = null;
			setListening(false);
			setPreparing(false);
		}
	}, [disabled]);
	const toggleVoice = async () => {
		if (listening) {
			voiceAttempt.current++;
			recognition.current?.stop();
			setListening(false);
			setPreparing(false);
			return;
		}
		recognition.current?.dispose();
		setVoiceError("");
		window.dispatchEvent(new Event("dcma-stop-speech"));
		const prefix = value.trimEnd();
		const attempt = ++voiceAttempt.current;
		setListening(true);
		setPreparing(true);
		try {
			await checkMicrophoneAccess();
			if (voiceAttempt.current !== attempt) return;
			setPreparing(false);
			recognition.current = startVoiceInput(
				(text) => {
					if (voiceAttempt.current === attempt)
						setValue(`${prefix}${prefix && text ? " " : ""}${text}`.slice(0, 8000));
				},
				(message) => {
					if (voiceAttempt.current === attempt) setVoiceError(message);
				},
				() => {
					if (voiceAttempt.current === attempt) setListening(false);
				},
			);
		} catch (error) {
			if (voiceAttempt.current !== attempt) return;
			setVoiceError(error instanceof Error ? error.message : "语音识别无法启动。");
			setListening(false);
			setPreparing(false);
		}
	};
	const composing = useRef(false);
	const send = () => {
		if (!value.trim() || disabled || listening) return;
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
		<div className="chat-composer">
			<div className="composer-content">
				<div className="composer-box">
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
						disabled={disabled || listening}
						placeholder="描述设备问题、告警信息或你想查询的内容…"
						rows={2}
						className="composer-textarea"
					/>
					<div className="composer-toolbar">
						<button
							type="button"
							onClick={onImport}
							aria-label="上传遥测日志或设备档案 (CSV/LOG)"
							title="上传遥测日志或设备档案"
							className="composer-attachment"
						>
							<Paperclip className="w-4 h-4" />
						</button>
						<button
							type="button"
							onClick={() => void toggleVoice()}
							disabled={disabled || !voiceAvailable}
							aria-label={listening ? "结束语音输入" : "开始语音输入"}
							aria-pressed={listening}
							title="浏览器语音识别可能使用在线服务，识别文字确认后发送"
							className={`composer-voice${listening ? " is-listening" : ""}`}
						>
							<Mic className="w-4 h-4" />
						</button>
						<span className="composer-spacer" />
						<select
							className="composer-model"
							aria-label="切换模型"
							title={
								models.length ? "切换模型（在设置中可配置模型 API）" : "暂无可用模型，请打开设置配置模型 API"
							}
							value={models.some((item) => item.id === model) ? model : ""}
							disabled={disabled || !models.length}
							onChange={(event) => onSelectModel(event.target.value)}
						>
							<option value="">{models.length ? "选择模型" : "无可用模型"}</option>
							{models.map((item) => (
								<option value={item.id} key={item.id}>
									{item.name.includes(" · ") ? item.name.slice(item.name.indexOf(" · ") + 3) : item.name}
								</option>
							))}
						</select>
						{disabled && onStop ? (
							<button type="button" aria-label="停止生成" onClick={onStop} className="composer-send is-stop">
								<Square className="w-4 h-4" />
							</button>
						) : (
							<button
								type="button"
								aria-label="发送问题"
								disabled={disabled || !value.trim() || listening}
								onClick={send}
								className="composer-send"
							>
								<Send className="w-4 h-4" />
							</button>
						)}
					</div>
				</div>
				{showColumnResizer && (
					<ColumnResizer
						width={columnWidth}
						maxWidth={columnMaxWidth}
						onResize={onColumnWidthChange}
						onReset={onColumnWidthReset}
					/>
				)}
				<p
					className="composer-note"
					aria-live="polite"
					title={
						voiceAvailable
							? "AI 建议仅供参考，请结合现场工况和操作规范确认。语音由浏览器识别，可能使用在线服务；识别文字确认后发送。"
							: "AI 建议仅供参考，请结合现场工况和操作规范确认。当前浏览器不支持语音输入，可继续使用键盘。"
					}
				>
					{listening
						? preparing
							? "正在检查麦克风权限…"
							: "正在听，结束后可编辑文字再发送。"
						: "AI 建议仅供参考，请结合现场工况和操作规范确认。"}
				</p>
				{voiceError && (
					<div className="mt-2 text-xs space-y-2">
						<p role="alert" className="text-red-700">
							{voiceError}
						</p>
						<p className="text-slate-600">
							可在 Chrome 打开 http://127.0.0.1:3000/ 后重试。也可点击上方输入框，按 Win+H 使用 Windows
							语音输入。
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
