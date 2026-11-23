import { type ReactNode, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { downloadSavedFile } from "../download.ts";
import { remarkKnowledgeLinks } from "../remark-knowledge-links.ts";
import { remarkLimitations } from "../remark-limitations.ts";
import { remarkSecondPrecision } from "../time-display.ts";

function MessageTable({ children }: { children: ReactNode }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="message-table">
			<div className="message-table-actions">
				<button
					type="button"
					aria-haspopup="dialog"
					onClick={() => {
						dialog.current?.showModal();
						setExpanded(true);
					}}
				>
					放大表格
				</button>
			</div>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need focus for keyboard scrolling. */}
			<section className="message-table-scroll" aria-label="表格，可横向滚动" tabIndex={0}>
				<table>{children}</table>
			</section>
			<dialog ref={dialog} className="message-table-dialog" aria-label="表格预览" onClose={() => setExpanded(false)}>
				<form method="dialog">
					<button type="submit">关闭预览</button>
				</form>
				{expanded && (
					<div className="message-table-scroll">
						<table>{children}</table>
					</div>
				)}
			</dialog>
		</div>
	);
}

const components: Components = {
	table: ({ children }) => <MessageTable>{children}</MessageTable>,
	a: ({ children, href, title }) => (
		<a
			href={href}
			title={title}
			target="_blank"
			rel="noopener noreferrer"
			onClick={
				href && /^\/api\/tools\/(?:reports\/[0-9a-f-]{36}\.(?:md|json)|charts\/[0-9a-f-]{36}\.csv)$/.test(href)
					? (event) => {
							event.preventDefault();
							downloadSavedFile(href);
						}
					: undefined
			}
		>
			{children}
		</a>
	),
};

export function MessageContent({ content }: { content: string }) {
	return (
		<div className="message-markdown">
			<Markdown
				remarkPlugins={[remarkGfm, remarkKnowledgeLinks, remarkSecondPrecision, remarkLimitations]}
				components={components}
				skipHtml
			>
				{content}
			</Markdown>
		</div>
	);
}
