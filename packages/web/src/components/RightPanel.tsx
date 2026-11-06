import { ListChecks, X } from "lucide-react";
import type { ChatMessage } from "../types.ts";
import { ExecutionDetails } from "./ExecutionDetails";

export function RightPanel({ message, open, onClose }: { message: ChatMessage; open: boolean; onClose: () => void }) {
	return (
		<aside className={`analysis-panel${open ? " is-open" : ""}`} aria-label="分析过程">
			<div className="analysis-heading">
				<div>
					<ListChecks size={19} />
					<h2>思考链 · 分析过程</h2>
				</div>
				<button type="button" onClick={onClose} aria-label="关闭分析过程" className="header-icon analysis-close">
					<X size={19} />
				</button>
			</div>
			<p className="analysis-caption">本轮处理步骤与查询证据</p>
			<div className="analysis-body">
				<ExecutionDetails key={message.id} message={message} expanded />
			</div>
		</aside>
	);
}
