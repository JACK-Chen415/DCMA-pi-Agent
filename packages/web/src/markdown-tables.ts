const fencePattern = /^\s*(?:```|~~~)/u;
const delimiterCellPattern = /^:?-+:?$/u;

function normalizePipes(line: string): string {
	return line.trim().replace(/\uFF5C/gu, "|");
}

function splitCells(line: string): string[] {
	const body = normalizePipes(line).replace(/^\|/u, "").replace(/\|$/u, "");
	const cells: string[] = [];
	let current = "";
	let inCode = false;
	let escaped = false;
	for (const character of body) {
		if (escaped) {
			current += `\\${character}`;
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "`") inCode = !inCode;
		if (character === "|" && !inCode) {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += character;
	}
	current += escaped ? "\\" : "";
	cells.push(current.trim());
	return cells;
}

function isTableRow(line: string): boolean {
	const normalized = normalizePipes(line);
	if (/^\|+\s*$/u.test(normalized)) return false;
	return splitCells(normalized).length >= 2;
}

function startsTableRow(line: string): boolean {
	return normalizePipes(line).startsWith("|") && isTableRow(line);
}

function isDelimiterRow(line: string): boolean {
	const cells = splitCells(line);
	return cells.length >= 1 && cells.every((cell) => delimiterCellPattern.test(cell));
}

function renderRow(cells: string[]): string {
	return `| ${cells.join(" | ")} |`;
}

/**
 * Repairs pseudo-tables that models sometimes emit (rows without the GFM delimiter line, or full-width
 * pipe separators) so reports render real tables instead of markdown source text.
 */
export function repairMarkdownTables(markdown: string): string {
	const lines = markdown.split(/\r?\n/u);
	const output: string[] = [];
	let inFence = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (fencePattern.test(line)) {
			inFence = !inFence;
			output.push(line);
			continue;
		}
		if (inFence || !startsTableRow(line)) {
			output.push(line);
			continue;
		}
		let end = index;
		const run: string[] = [];
		while (end < lines.length && isTableRow(lines[end] ?? "")) {
			run.push(lines[end] ?? "");
			end++;
		}
		if (run.length < 2) {
			output.push(line);
			index = end - 1;
			continue;
		}
		const previous = output.at(-1) ?? "";
		if (previous.trim() !== "") output.push("");
		const rows = run.map((row) => renderRow(splitCells(row)));
		if (!rows.some((row) => isDelimiterRow(row))) {
			const header = rows[0] ?? "";
			rows.splice(1, 0, renderRow(splitCells(header).map(() => "---")));
		}
		output.push(...rows);
		index = end - 1;
		if ((lines[end] ?? "").trim() !== "") output.push("");
	}
	return output.join("\n");
}
