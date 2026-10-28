/** Message identifiers are UUIDs even on HTTP origins without randomUUID. */
export function createMessageId(): string {
	const source = globalThis.crypto;
	if (typeof source?.randomUUID === "function") return source.randomUUID();
	if (typeof source?.getRandomValues !== "function")
		throw new Error("当前浏览器无法生成消息编号，请升级浏览器或通过 HTTPS 访问。");
	const bytes = source.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
