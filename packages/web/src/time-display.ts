/** Human-facing precision only; keep stored timestamps and query boundaries intact. */
export function timeToSeconds(text: string): string {
	return text.replace(/((?:\b|T)(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\.\d+/g, "$1");
}

interface MarkdownNode {
	type: string;
	value?: string;
	children?: MarkdownNode[];
}

/** Format visible Markdown text without rewriting link targets or raw code blocks. */
export function remarkSecondPrecision() {
	return function visit(node: MarkdownNode): void {
		if ((node.type === "text" || node.type === "inlineCode") && node.value) node.value = timeToSeconds(node.value);
		for (const child of node.children ?? []) visit(child);
	};
}
