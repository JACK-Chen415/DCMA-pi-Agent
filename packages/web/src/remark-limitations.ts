interface MarkdownNode {
	type: string;
	value?: string;
	children?: MarkdownNode[];
	data?: { hProperties?: Record<string, unknown> };
}

function nodeText(node: MarkdownNode): string {
	return node.value ?? node.children?.map(nodeText).join("") ?? "";
}

/** Only the explicitly labelled limitation paragraph receives secondary typography. */
export function remarkLimitations() {
	return function visit(node: MarkdownNode): void {
		if (node.type === "paragraph" && /^限制说明\s*[:：]/.test(nodeText(node).trimStart())) {
			node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: "answer-limitation" } };
		}
		for (const child of node.children ?? []) visit(child);
	};
}
