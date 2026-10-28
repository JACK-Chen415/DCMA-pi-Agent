import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createTextStream } from "../tools/text-stream.ts";

test("assistant message boundaries separate a report heading without changing chunks or code within a message", () => {
	const stream = createTextStream();
	const message = fauxAssistantMessage("");
	const delta = (text: string) =>
		stream({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text, partial: message },
		});
	let output = delta("我先读取事件。");
	stream({ type: "message_end", message });
	// A tool-only assistant message between textual messages must not remove the pending boundary.
	stream({ type: "message_end", message });
	assert.equal(delta(""), "");
	for (const chunk of ["#", "# 运行报告\n\n", "```text\n", "F07090", "\n```\n"]) output += delta(chunk);
	assert.equal(output, "我先读取事件。\n\n## 运行报告\n\n```text\nF07090\n```\n");
	const emptyStream = createTextStream();
	assert.equal(emptyStream({ type: "message_end", message }), "");
	assert.equal(
		emptyStream({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "正文", partial: message },
		}),
		"正文",
	);
});
