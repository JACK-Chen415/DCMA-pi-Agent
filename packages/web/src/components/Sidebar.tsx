import { Download, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ConversationItem } from "../types.ts";
export function Sidebar({
	conversations,
	activeId,
	onSelectConversation,
	onNewChat,
	onRename,
	onDelete,
	onExport,
	open,
	onClose,
}: {
	conversations: ConversationItem[];
	activeId: string | null;
	onSelectConversation: (id: string) => void;
	onNewChat: () => void;
	onRename: (id: string) => void;
	onDelete: (id: string) => void;
	onExport: () => void;
	open: boolean;
	onClose: () => void;
}) {
	return (
		<aside
			aria-label="会话历史"
			className={`${open ? "flex fixed inset-y-0 left-0 bg-[#f4f7fb] shadow-xl z-40" : "hidden lg:flex"} w-[260px] h-full flex-col shrink-0 px-4 py-5`}
		>
			<div className="flex items-center gap-3 mb-6">
				<img src="/assets/logo.png" alt="DCMA Logo" className="w-9 h-9" />
				<div className="flex-1">
					<strong className="text-lg">DCMA</strong>
					<p className="text-xs text-slate-500">工业故障诊断助手</p>
				</div>
				{open && (
					<button type="button" aria-label="关闭会话历史" onClick={onClose}>
						<X className="w-5 h-5" />
					</button>
				)}
			</div>
			<button
				type="button"
				onClick={onNewChat}
				className="w-full h-10 bg-white border border-blue-200 text-blue-600 rounded-xl flex gap-2 items-center justify-center mb-5"
			>
				<Plus className="w-4 h-4" />
				新建对话
			</button>
			<p className="text-xs text-slate-500 mb-3">最近对话 · {conversations.length}</p>
			<div className="flex-1 overflow-y-auto space-y-2">
				{!conversations.length && (
					<p className="text-xs text-slate-400 py-4">发送问题后，会话会自动保存到本浏览器。</p>
				)}
				{conversations.map((item) => (
					<div
						key={item.id}
						className={`rounded-xl p-2 ${activeId === item.id ? "bg-blue-50" : "hover:bg-slate-100"}`}
					>
						<button
							type="button"
							onClick={() => onSelectConversation(item.id)}
							className="flex gap-2 w-full text-left"
						>
							<MessageSquare className="w-4 h-4 text-blue-600 shrink-0 mt-1" />
							<div className="min-w-0">
								<p className="truncate text-[13px] font-medium">{item.title}</p>
								<p className="text-[11px] text-slate-400 mt-1">
									{new Date(item.time).toLocaleString("zh-CN", {
										month: "2-digit",
										day: "2-digit",
										hour: "2-digit",
										minute: "2-digit",
									})}
								</p>
							</div>
						</button>
						<div className="flex justify-end gap-3 mt-1">
							<button
								type="button"
								aria-label={`重命名会话：${item.title}`}
								onClick={() => onRename(item.id)}
								className="p-1 text-slate-400 hover:text-blue-600"
							>
								<Pencil className="w-3 h-3" />
							</button>
							<button
								type="button"
								aria-label={`删除会话：${item.title}`}
								onClick={() => onDelete(item.id)}
								className="p-1 text-slate-400 hover:text-red-600"
							>
								<Trash2 className="w-3 h-3" />
							</button>
						</div>
					</div>
				))}
			</div>
			<button
				type="button"
				disabled={!conversations.length}
				onClick={onExport}
				className="flex items-center justify-center gap-2 text-xs text-slate-500 py-3 disabled:opacity-40"
			>
				<Download className="w-3 h-3" />
				导出会话记录
			</button>
		</aside>
	);
}
