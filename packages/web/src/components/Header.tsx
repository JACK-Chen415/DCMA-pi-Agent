import { Activity, Menu, Settings } from "lucide-react";
import type { BackendStatus } from "../types.ts";
export function Header({
	onOpenSettings,
	onOpenHistory,
	onOpenPanel,
	status,
}: {
	onOpenSettings: () => void;
	onOpenHistory: () => void;
	onOpenPanel: () => void;
	status: BackendStatus;
}) {
	return (
		<header className="h-16 shrink-0 flex items-center justify-between gap-2 px-4 sm:px-6">
			<div className="flex items-center gap-2 min-w-0">
				<button
					type="button"
					aria-label="打开会话历史"
					onClick={onOpenHistory}
					className="lg:hidden p-2 bg-white rounded-xl"
				>
					<Menu className="w-5 h-5" />
				</button>
				<span className="text-xs text-slate-500 truncate">DCMA Agent 模型对话</span>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<span
					title={status.message}
					className="text-[11px] rounded-full bg-white border border-slate-200 px-3 py-2 flex gap-2 items-center"
				>
					<span className={`h-2 w-2 rounded-full ${status.connected ? "bg-emerald-500" : "bg-amber-500"}`} />
					{status.connected ? "服务已连接" : "服务未连接"}
				</span>
				<button
					type="button"
					onClick={onOpenPanel}
					aria-label="打开设备看板"
					className="xl:hidden p-2 rounded-xl bg-white border border-slate-200"
				>
					<Activity className="w-4 h-4" />
				</button>
				<button
					type="button"
					onClick={onOpenSettings}
					aria-label="系统设置与DCMA Agent配置"
					className="p-2 rounded-xl bg-white border border-slate-200"
				>
					<Settings className="w-4 h-4" />
				</button>
			</div>
		</header>
	);
}
