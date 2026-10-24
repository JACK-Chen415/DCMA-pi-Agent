interface RecognitionResult {
	readonly isFinal: boolean;
	readonly [index: number]: { transcript: string };
}
interface RecognitionEvent {
	results: ArrayLike<RecognitionResult>;
}
interface Recognition {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult: ((event: RecognitionEvent) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}
interface SpeechWindow {
	SpeechRecognition?: new () => Recognition;
	webkitSpeechRecognition?: new () => Recognition;
}
interface MicrophoneEnvironment {
	mediaDevices?: {
		getUserMedia(constraints: { audio: true }): Promise<{ getTracks(): { stop(): void }[] }>;
	};
}
/** Request permission on the user's click, then release the probe before recognition opens the device. */
export async function checkMicrophoneAccess(): Promise<void> {
	const media = (globalThis.navigator as MicrophoneEnvironment | undefined)?.mediaDevices;
	if (!media?.getUserMedia)
		throw new Error("当前浏览器未提供麦克风访问能力，请在 Chrome 中打开本页面，或使用 Windows 语音输入（Win+H）。");
	try {
		const stream = await media.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
	} catch (error) {
		const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
		if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name))
			throw new Error("麦克风访问被拒绝，请允许当前页面使用麦克风，并检查 Windows 的麦克风隐私设置。");
		if (["NotFoundError", "DevicesNotFoundError"].includes(name))
			throw new Error("浏览器未找到可用的音频输入设备，请在 Windows 声音设置中检查输入设备是否启用。");
		if (["NotReadableError", "TrackStartError"].includes(name))
			throw new Error("麦克风存在但无法打开，可能正被其他程序独占或被系统限制，请检查后重试。");
		throw new Error("当前浏览器无法打开麦克风，请在 Chrome 中重试，或使用 Windows 语音输入（Win+H）。");
	}
}
export function voiceInputAvailable(): boolean {
	const browser = (globalThis as { window?: SpeechWindow }).window;
	return !!(browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition);
}
export function startVoiceInput(onText: (text: string) => void, onError: (message: string) => void, onEnd: () => void) {
	const browser = (globalThis as { window?: SpeechWindow }).window;
	const Constructor = browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition;
	if (!Constructor) throw new Error("当前浏览器不支持语音输入，请使用支持语音识别的浏览器或键盘输入。");
	const recognition = new Constructor();
	let ended = false;
	const finish = () => {
		if (ended) return;
		ended = true;
		onEnd();
	};
	recognition.lang = "zh-CN";
	recognition.continuous = false;
	recognition.interimResults = true;
	recognition.onresult = (event) => onText(Array.from(event.results, (result) => result[0].transcript).join(""));
	recognition.onerror = ({ error }) => {
		if (error === "aborted") {
			finish();
			return;
		}
		onError(
			(
				{
					"not-allowed": "麦克风权限被拒绝，请在浏览器中允许后重试。",
					"service-not-allowed": "浏览器未允许语音识别服务，请改用键盘输入。",
					"audio-capture":
						"麦克风访问检查已通过，但浏览器语音识别服务无法采集音频。请在 Chrome 中重试；内置浏览器可能不支持此语音服务。",
					network: "语音识别服务未连接，请检查网络后重试。",
					"no-speech": "没有识别到语音，请再试一次。",
					"language-not-supported": "当前语音服务不支持中文，请改用键盘输入。",
				} as Record<string, string>
			)[error] ?? "语音识别失败，请重试或使用键盘输入。",
		);
		finish();
		recognition.abort();
	};
	recognition.onend = finish;
	recognition.start();
	return {
		stop: () => recognition.stop(),
		dispose: () => {
			ended = true;
			recognition.onresult = null;
			recognition.onerror = null;
			recognition.onend = null;
			recognition.abort();
		},
	};
}
export function spokenText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?(?:```|$)/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, "")
		.replace(/^[\s|:-]+$/gm, "")
		.replace(/[`*_~|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
