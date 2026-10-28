/** Human-facing precision only; keep stored timestamps and query boundaries intact. */
export function timeToSeconds(text: string): string {
	return text.replace(/((?:\b|T)(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\.\d+/g, "$1");
}

function beijingTimes(text: string): string {
	return text.replace(
		/\b(\d{4}-\d{2}-\d{2})[T ]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.\d+)?(Z|[+-]\d{2}:\d{2})\b/g,
		(value, day: string) => {
			const date = new Date(value.replace(" ", "T"));
			const calendar = new Date(`${day}T00:00:00Z`);
			if (
				!Number.isFinite(date.getTime()) ||
				!Number.isFinite(calendar.getTime()) ||
				calendar.toISOString().slice(0, 10) !== day
			)
				return value;
			return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
		},
	);
}

interface MarkdownNode {
	type: string;
	value?: string;
	children?: MarkdownNode[];
}

/** Format visible Markdown text without rewriting link targets or raw code blocks. */
export function remarkSecondPrecision() {
	return function visit(node: MarkdownNode): void {
		if (node.type === "text" && node.value) node.value = timeToSeconds(beijingTimes(node.value));
		if (node.type === "inlineCode" && node.value) node.value = timeToSeconds(node.value);
		for (const child of node.children ?? []) visit(child);
	};
}
