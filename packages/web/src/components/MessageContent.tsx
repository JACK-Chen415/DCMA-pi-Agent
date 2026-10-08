import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
	table: ({ children }) => (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need focus for keyboard scrolling.
		<section className="message-table-scroll" aria-label="表格，可横向滚动" tabIndex={0}>
			<table>{children}</table>
		</section>
	),
	a: ({ children, href, title }) => (
		<a href={href} title={title} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	),
};

export function MessageContent({ content }: { content: string }) {
	return (
		<div className="message-markdown">
			<Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
				{content}
			</Markdown>
		</div>
	);
}
