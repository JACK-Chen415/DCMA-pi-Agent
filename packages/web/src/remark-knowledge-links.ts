interface MarkdownNode {
	type: string;
	value?: string;
	url?: string;
	children?: MarkdownNode[];
}

/** Turn only local knowledge-source addresses into links; never reinterpret code blocks or link targets. */
export function remarkKnowledgeLinks() {
	function visit(node: MarkdownNode): MarkdownNode[] {
		if (node.type === "code" || node.type === "link") return [node];
		if ((node.type === "text" || node.type === "inlineCode") && node.value) {
			const matches = [...node.value.matchAll(/\/api\/knowledge\/context\?[A-Za-z0-9%_~=&.:-]+/g)];
			if (node.type === "inlineCode" && (matches.length !== 1 || matches[0][0] !== node.value)) return [node];
			const children: MarkdownNode[] = [];
			let start = 0;
			for (const match of matches) {
				const url = new URL(match[0], "http://localhost");
				if (!url.searchParams.get("id") && !url.searchParams.get("code")) continue;
				if (match.index > start) children.push({ type: "text", value: node.value.slice(start, match.index) });
				children.push({ type: "link", url: match[0], children: [{ type: "text", value: "查看资料原文" }] });
				start = match.index + match[0].length;
			}
			if (!children.length) return [node];
			if (start < node.value.length) children.push({ type: "text", value: node.value.slice(start) });
			return children;
		}
		if (node.children) node.children = node.children.flatMap(visit);
		return [node];
	}
	return function transform(tree: MarkdownNode): void {
		visit(tree);
	};
}
