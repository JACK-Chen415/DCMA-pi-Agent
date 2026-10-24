import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { spokenText } from "../speech.ts";

export function SpeakButton({ content }: { content: string }) {
	const [speaking, setSpeaking] = useState(false);
	const [error, setError] = useState("");
	const active = useRef(false);
	const generation = useRef(0);
	const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);
	const supported =
		typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
	useEffect(() => {
		const stop = () => {
			if (active.current) {
				generation.current++;
				active.current = false;
				currentUtterance.current = null;
				window.speechSynthesis.cancel();
				setSpeaking(false);
			}
		};
		window.addEventListener("dcma-stop-speech", stop);
		return () => {
			window.removeEventListener("dcma-stop-speech", stop);
			if (active.current) {
				generation.current++;
				active.current = false;
				window.speechSynthesis.cancel();
			}
		};
	}, []);
	if (!supported) return <span className="text-xs text-slate-500">此浏览器不支持朗读</span>;
	const play = () => {
		const wasSpeaking = active.current;
		window.dispatchEvent(new Event("dcma-stop-speech"));
		if (wasSpeaking) return;
		setError("");
		const chunks = spokenText(content).match(/[^。！？\n]{1,180}[。！？\n]?/gu) ?? [];
		if (!chunks.length) {
			setError("没有可朗读的文字。");
			return;
		}
		active.current = true;
		const playback = ++generation.current;
		setSpeaking(true);
		const next = () => {
			if (!active.current || playback !== generation.current) return;
			const text = chunks.shift();
			if (!text) {
				active.current = false;
				currentUtterance.current = null;
				setSpeaking(false);
				return;
			}
			const utterance = new SpeechSynthesisUtterance(text);
			currentUtterance.current = utterance;
			utterance.lang = "zh-CN";
			utterance.onend = next;
			utterance.onerror = () => {
				if (active.current && playback === generation.current) {
					active.current = false;
					currentUtterance.current = null;
					setSpeaking(false);
					setError("朗读失败，请检查浏览器语音设置后重试。");
				}
			};
			window.speechSynthesis.speak(utterance);
		};
		next();
	};
	return (
		<>
			<button type="button" onClick={play} aria-pressed={speaking}>
				{speaking ? <Square size={14} /> : <Volume2 size={14} />}
				{speaking ? "停止朗读" : "朗读回答"}
			</button>
			{error && <span role="alert">{error}</span>}
		</>
	);
}
