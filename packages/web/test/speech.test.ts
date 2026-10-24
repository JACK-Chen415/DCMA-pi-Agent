import assert from "node:assert/strict";
import test from "node:test";
import { checkMicrophoneAccess, spokenText, startVoiceInput, voiceInputAvailable } from "../src/speech.ts";

test("microphone preflight requests audio only and releases every track before recognition", async (context) => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	context.after(() => {
		if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
		else Reflect.deleteProperty(globalThis, "navigator");
	});
	let stopped = 0;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			mediaDevices: {
				async getUserMedia(constraints: unknown) {
					assert.deepEqual(constraints, { audio: true });
					return { getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] };
				},
			},
		},
	});
	await checkMicrophoneAccess();
	assert.equal(stopped, 2);
});

test("microphone preflight distinguishes unsupported browser, permission denial, missing device and capture failure", async (context) => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	context.after(() => {
		if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
		else Reflect.deleteProperty(globalThis, "navigator");
	});
	Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
	await assert.rejects(checkMicrophoneAccess(), /未提供麦克风访问能力/);
	for (const [name, expected] of [
		["NotAllowedError", /访问被拒绝/],
		["NotFoundError", /未找到可用/],
		["NotReadableError", /存在但无法打开/],
		["AbortError", /当前浏览器无法打开/],
	] as const) {
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: {
				mediaDevices: {
					async getUserMedia() {
						throw Object.assign(new Error("fixture"), { name });
					},
				},
			},
		});
		await assert.rejects(checkMicrophoneAccess(), expected);
	}
});

test("voice input reports capabilities, retains Chinese transcription and cleans up microphone handlers", (context) => {
	class Recognition {
		lang = "";
		continuous = true;
		interimResults = false;
		onresult: ((event: { results: { 0: { transcript: string }; isFinal: boolean }[] }) => void) | null = null;
		onerror: ((event: { error: string }) => void) | null = null;
		onend: (() => void) | null = null;
		started = false;
		stopped = false;
		aborted = false;
		constructor() {
			current = this;
		}
		start() {
			this.started = true;
		}
		stop() {
			this.stopped = true;
			this.onend?.();
		}
		abort() {
			this.aborted = true;
		}
	}
	let current: Recognition;
	const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", { configurable: true, value: { webkitSpeechRecognition: Recognition } });
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, "window", previous);
		else Reflect.deleteProperty(globalThis, "window");
	});
	assert.equal(voiceInputAvailable(), true);
	const texts: string[] = [],
		errors: string[] = [];
	let ended = false;
	let endCount = 0;
	const controller = startVoiceInput(
		(text) => texts.push(text),
		(error) => errors.push(error),
		() => {
			ended = true;
			endCount++;
		},
	);
	assert.equal(current!.lang, "zh-CN");
	assert.equal(current!.started, true);
	current!.onresult?.({ results: [{ 0: { transcript: "统计温度" }, isFinal: false }] });
	current!.onresult?.({ results: [{ 0: { transcript: "统计温度超过五十度" }, isFinal: true }] });
	assert.deepEqual(texts, ["统计温度", "统计温度超过五十度"]);
	current!.onerror?.({ error: "not-allowed" });
	assert.match(errors[0], /权限被拒绝/);
	assert.equal(ended, true, "an error must unlock the input even when the browser never emits onend");
	current!.onerror?.({ error: "network" });
	assert.match(errors[1], /网络/);
	current!.onerror?.({ error: "aborted" });
	assert.equal(errors.length, 2);
	current!.onerror?.({ error: "audio-capture" });
	assert.match(errors[2], /内置浏览器可能不支持/);
	assert.ok(!errors[2].includes("检查设备连接"));
	controller.stop();
	assert.equal(ended, true);
	assert.equal(endCount, 1);
	controller.dispose();
	assert.equal(current!.aborted, true);
	assert.equal(current!.onresult, null);
	Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
	assert.equal(voiceInputAvailable(), false);
	assert.throws(
		() =>
			startVoiceInput(
				() => {},
				() => {},
				() => {},
			),
		/不支持语音/,
	);
});

test("reading text skips markdown syntax, URLs and code while retaining Chinese conclusions and numbers", () => {
	const text = spokenText(
		"## 结论\n\n温度 **-2℃**，最高 50℃。[手册](https://example.com)\n```js\nsecret();\n```\n![图](https://example.com/a.png)",
	);
	assert.match(text, /温度 -2℃/);
	assert.match(text, /最高 50℃/);
	assert.match(text, /手册/);
	assert.ok(!/https|secret|```|\*\*/.test(text));
	assert.match(spokenText("## 读数\n-2℃\n- 电机温度：-3℃"), /-2℃.*-3℃/);
});
