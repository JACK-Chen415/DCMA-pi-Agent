import type { FaultKnowledgeRecord } from "./knowledge-index.ts";

interface Entry {
	text: string;
	title: string;
	codes: string[];
	pages: number[];
	complete: boolean;
}
const cache = new WeakMap<FaultKnowledgeRecord[], Map<string, Entry[]>>();

/** Assemble source definitions after retrieval; the indexed text and its vectors remain unchanged. */
export function faultKnowledgeContext(records: FaultKnowledgeRecord[], item: FaultKnowledgeRecord, code = "") {
	if (item.kind !== "drive_fault_manual" || item.page === null) return item;
	let entriesByRecord = cache.get(records);
	if (!entriesByRecord) {
		entriesByRecord = new Map();
		const sources = new Map<string, FaultKnowledgeRecord[]>();
		for (const record of records) {
			if (record.kind !== "drive_fault_manual" || record.page === null) continue;
			const source = sources.get(record.source_id) ?? [];
			source.push(record);
			sources.set(record.source_id, source);
		}
		for (const source of sources.values()) {
			source.sort((a, b) => a.page! - b.page!);
			const definitionPages = new Set(source.filter(record => /4\.2\s*故障和报警列表/.test(record.text)).map(record => record.page));
			let text = "";
			const spans: { start: number; end: number; record: FaultKnowledgeRecord }[] = [];
			for (const record of source) {
				// PDF page furniture can be glued to the next definition; remove it before finding boundaries.
				const value = record.text.replace(/\r\n/g, "\n")
					.replace(/^(?:SINAMICS S120\/S150|4\s+故障和报警|4\.2\s*故障和报警列表)[ \t]*\n?/gm, "")
					.replace(/^[^\n]*参数手册[^\n]*?6SL\d{4}[ \t]*-[ \t]*[A-Z0-9]+[ \t]*-[ \t]*[A-Z0-9]{4}[ \t]*/gm, "")
					.trim();
				let overlap = 0;
				if (spans.at(-1)?.record.page === record.page) {
					for (let length = Math.min(200, text.length, value.length); length >= 20; length--) {
						if (text.endsWith(value.slice(0, length))) { overlap = length; break; }
					}
				}
				if (!overlap && text) text += "\n";
				const start = text.length - overlap;
				text += value.slice(overlap);
				spans.push({ start, end: text.length, record });
			}
			// A real definition heading is followed by its information-value field, unlike references to a code.
			const headings = [...text.matchAll(/^([FANCW]\d{4,6})[ \t]+([^\n]+)\n(?=信息值[：:])/gm)];
			for (let index = 0; index < headings.length; index++) {
				const heading = headings[index];
				const start = heading.index;
				let end = headings[index + 1]?.index ?? text.length;
				const owners = spans.filter(span => span.end > start && span.start < end);
				let complete = index + 1 < headings.length;
				for (let part = 1; part < owners.length; part++) {
					if (owners[part].record.page! - owners[part - 1].record.page! > 1 ||
						(definitionPages.size > 0 && !definitionPages.has(owners[part].record.page))) {
						end = owners[part - 1].end;
						owners.splice(part);
						complete = false;
						break;
					}
				}
				const body = text.slice(start, end).trim();
				if (body.length > 20000) continue;
				const alternatives = heading[2].match(/^\(([FANCW,\s]+)\)/)?.[1] ?? "";
				const entry: Entry = {
					text: body, title: `${heading[1]} ${heading[2]}`,
					codes: [...new Set([heading[1], ...(alternatives.match(/[FANCW]/g) ?? []).map(prefix => prefix + heading[1].slice(1))])],
					pages: [...new Set(owners.map(owner => owner.record.page!))], complete,
				};
				for (const owner of owners) {
					const entries = entriesByRecord.get(owner.record.id) ?? [];
					entries.push(entry);
					entriesByRecord.set(owner.record.id, entries);
				}
			}
		}
		cache.set(records, entriesByRecord);
	}
	const available = entriesByRecord.get(item.id) ?? [];
	const entries = available.filter(entry => !code || entry.codes.includes(code.toUpperCase()));
	if (!entries.length) return code && available.length ? null : { ...item, context_complete: false };
	const pages = [...new Set(entries.flatMap(entry => entry.pages))].sort((a, b) => a - b);
	return {
		...item,
		title: [...new Set(entries.map(entry => entry.title))].join("；"),
		text: entries.map(entry => entry.text).join("\n\n"),
		codes: [...new Set(entries.flatMap(entry => entry.codes))],
		page: pages[0],
		locator: `第 ${pages.join("、")} 页`,
		context_complete: entries.every(entry => entry.complete),
		context_note: "检索分数对应原始索引片段；正文按故障条目边界补齐，多个驱动对象的定义分别保留。",
	};
}
