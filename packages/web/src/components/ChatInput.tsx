import { Mic, Paperclip, Send, Square } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { defaultWebKeybindings } from "../keyboard.ts";
import { checkMicrophoneAccess, startVoiceInput, voiceInputAvailable } from "../speech.ts";
export function ChatInput({
	onSendMessage,
	disabled,
	onStop,
	onImport,
}: {
	onSendMessage: (text: string) => void;
	disabled: boolean;
	onStop?: () => void;
	onImport: () => void;
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
		<div className="shrink-0 px-3 sm:px-6 pb-4 pt-2">
			<div className="relative max-w-[800px] mx-auto">
				<div className="bg-white border border-slate-200 rounded-2xl p-2 flex gap-1 items-center shadow-sm focus-within:border-blue-400">
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
						disabled={disabled || listening}
						placeholder="输入问题，Enter 发送，Shift+Enter 换行…"
						rows={1}
						className="min-w-0 flex-1 h-9 bg-transparent outline-none text-sm leading-5 resize-none overflow-y-auto px-2 py-2 disabled:opacity-50"
					/>
					<button
						type="button"
						onClick={() => void toggleVoice()}
						disabled={disabled || !voiceAvailable}
						aria-label={listening ? "结束语音输入" : "开始语音输入"}
						aria-pressed={listening}
						title="浏览器语音识别可能使用在线服务，识别文字确认后发送"
						className={`shrink-0 min-h-11 min-w-11 p-2 rounded-xl disabled:opacity-40 ${listening ? "bg-red-50 text-red-700" : "text-slate-600 hover:bg-blue-50"}`}
					>
						<Mic className="w-4 h-4 mx-auto" />
					</button>
					{disabled && onStop ? (
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
							disabled={disabled || !value.trim() || listening}
							onClick={send}
							className="p-2 bg-blue-600 text-white rounded-xl disabled:opacity-40"
						>
							<Send className="w-4 h-4" />
						</button>
					)}
				</div>
				<p className="mt-2 text-[11px] text-slate-500" aria-live="polite">
					{listening
						? preparing
							? "正在检查麦克风访问，请处理浏览器的权限提示。"
							: "正在听，请说话；结束后可编辑文字再发送。"
						: voiceAvailable
							? "语音由浏览器识别，可能使用在线服务；识别文字确认后发送。"
							: "当前浏览器不支持语音输入，可继续使用键盘。"}
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
