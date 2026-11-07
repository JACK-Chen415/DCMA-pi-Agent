import { Activity, ListChecks, PanelLeft, Plus, Settings, SlidersHorizontal } from "lucide-react";
import type { BackendStatus } from "../types.ts";

export function Header({
	onOpenSettings,
	onToggleHistory,
	onOpenPanel,
	onNewChat,
	onSwitchDevice,
	onRealtime,
	sidebarOpen,
	hasAnalysis,
	status,
}: {
	onOpenSettings: () => void;
	onToggleHistory: () => void;
	onOpenPanel: () => void;
	onNewChat: () => void;
	onSwitchDevice: () => void;
	onRealtime: () => void;
	sidebarOpen: boolean;
	hasAnalysis: boolean;
	status: BackendStatus;
}) {
	return (
		<header className="app-header">
			<div className="header-brand">
				<button
					type="button"
					className="header-icon"
					aria-label={sidebarOpen ? "收起会话历史" : "展开会话历史"}
					aria-expanded={sidebarOpen}
					aria-controls="conversation-sidebar"
					onClick={onToggleHistory}
				>
					<PanelLeft size={20} />
				</button>
				<button type="button" className="header-new" onClick={onNewChat} aria-label="新对话" title="新对话">
					<Plus size={17} />
					<span>新对话</span>
				</button>
				<img src="/assets/sztu.jpg" alt="深圳技术大学校徽" />
				<div className="brand-copy">
					<strong>MSPIC-AI</strong>
					<p>DCMA 工业运行诊断系统 · 基于 Agent 的智能分析</p>
				</div>
			</div>
			<div className="header-tools">
				<span className="service-status" title={status.message}>
					<i data-connected={status.connected} />
					<span>{status.connected ? "服务已连接" : "服务未连接"}</span>
				</span>
				<button
					type="button"
					className="header-action"
					onClick={onSwitchDevice}
					aria-label="切换设备"
					title="切换设备"
				>
					<SlidersHorizontal size={17} />
					<span>切换设备</span>
				</button>
				<button
					type="button"
					className="header-action header-realtime"
					onClick={onRealtime}
					aria-label="实时数据"
					title="实时数据"
				>
					<Activity size={17} />
					<span>实时数据</span>
				</button>
				{hasAnalysis && (
					<button
						type="button"
						className="header-icon analysis-toggle"
						onClick={onOpenPanel}
						aria-label="打开分析过程"
						title="分析过程"
					>
						<ListChecks size={19} />
					</button>
				)}
				<button
					type="button"
					className="header-icon"
					onClick={onOpenSettings}
					aria-label="系统设置与MSPIC-AI配置"
					title="设置"
				>
					<Settings size={19} />
				</button>
			</div>
		</header>
	);
}
