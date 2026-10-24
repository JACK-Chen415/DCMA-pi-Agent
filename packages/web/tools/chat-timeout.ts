/** Separate provider silence from total work; useful work must not reset the total ceiling. */
export function createChatTimeout(onTimeout: (message: string) => void, silenceMs = 120000, maximumMs = 300000) {
	let stage = "等待模型响应";
	let silence: ReturnType<typeof setTimeout>;
	let stopped = false;
	const expire = (reason: string) => {
		if (stopped) return;
		stopped = true;
		clearTimeout(silence);
		clearTimeout(total);
		onTimeout(`${reason}（${stage}）。已取得的内容和证据会保留，可缩小问题范围后重试。`);
	};
	const total = setTimeout(() => expire("本次分析已达到5分钟总时限"), maximumMs);
	const touch = (nextStage = stage) => {
		if (stopped) return;
		stage = nextStage;
		clearTimeout(silence);
		silence = setTimeout(() => expire("长时间未收到模型或工具的新进展"), silenceMs);
	};
	touch();
	return {
		touch,
		dispose() {
			stopped = true;
			clearTimeout(silence);
			clearTimeout(total);
		},
	};
}
