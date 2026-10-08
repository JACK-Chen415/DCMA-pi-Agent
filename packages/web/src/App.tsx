import { useEffect, useRef, useState } from "react";
import { analyzeLocally } from "./analysis.ts";
import { getBackendStatus, streamChat } from "./api.ts";
import { ChatInput } from "./components/ChatInput";
import { ChatView } from "./components/ChatView";
import { DeviceModal } from "./components/DeviceModal";
import { Header } from "./components/Header";
import { Modal } from "./components/Modal";
import { RightPanel } from "./components/RightPanel";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TelemetryModal } from "./components/TelemetryModal";
import { WelcomeView } from "./components/WelcomeView";
import { downloadText } from "./download.ts";
import { createDemoDatasets, initialDevices } from "./mockData.ts";
import { loadWorkspace, storageKey } from "./storage.ts";
import { getMetrics, parseTelemetry, telemetryCsv } from "./telemetry.ts";
import type { AppSettings, BackendStatus, ChatMessage, ToolId } from "./types.ts";

export function App() {
	const [workspace, setWorkspace] = useState(loadWorkspace);
	const [backend, setBackend] = useState<BackendStatus>({ connected: false, models: [], message: "正在连接本地服务" });
	const [checkedAt, setCheckedAt] = useState("");
	const [modal, setModal] = useState<"device" | "telemetry" | "settings" | "import" | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [panelOpen, setPanelOpen] = useState(false);
	const [notice, setNotice] = useState("");
	const [storageError, setStorageError] = useState("");
	const [importError, setImportError] = useState("");
	const [importing, setImporting] = useState(false);
	const [renameId, setRenameId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const request = useRef<AbortController | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const device = initialDevices.find((item) => item.id === workspace.deviceId) ?? initialDevices[0];
	const dataset = workspace.datasets[device.id];
	const conversation = workspace.conversations.find((item) => item.id === workspace.activeId);
	const settings = workspace.settings;

	useEffect(() => {
		const timer = setTimeout(() => {
			try {
				localStorage.setItem(storageKey, JSON.stringify(workspace));
				setStorageError("");
			} catch {
				setStorageError("浏览器存储空间不足，当前数据尚未保存。请导出会话和数据以保留记录。");
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [workspace]);
	useEffect(() => {
		const controller = new AbortController();
		let loading = false;
		const poll = async () => {
			if (loading) return;
			loading = true;
			try {
				const status = await getBackendStatus(AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
				if (!controller.signal.aborted) {
					setBackend(status);
					setCheckedAt(new Date().toLocaleTimeString("zh-CN"));
				}
			} catch {
				if (!controller.signal.aborted)
					setBackend({ connected: false, models: [], message: "本地后端未连接，请检查 npm run web:dev 服务" });
			} finally {
				loading = false;
			}
		};
		void poll();
		const timer = setInterval(() => {
			void poll();
		}, settings.telemetryIntervalMs);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	}, [settings.telemetryIntervalMs]);
	useEffect(() => () => request.current?.abort(), []);
	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(""), 7000);
		return () => clearTimeout(timer);
	}, [notice]);

	const stop = () => {
		request.current?.abort();
	};
	const newChat = () => {
		stop();
		setWorkspace((state) => ({ ...state, activeId: null }));
		setSidebarOpen(false);
	};
	const refreshModels = async () => {
		try {
			setBackend(await getBackendStatus(AbortSignal.timeout(15000), true));
			setNotice("模型状态已刷新");
		} catch {
			setNotice("无法刷新模型列表，请检查后端服务。");
		}
	};
	const sendMessage = async (text: string) => {
		if (!text.trim() || request.current) return;
		if (workspace.conversations.length >= 50 && !conversation) {
			setNotice("最多保留 50 个会话，请先导出并删除不需要的会话。");
			return;
		}
		if ((conversation?.messages.length ?? 0) >= 198) {
			setNotice("当前会话已达到 200 条消息，请开启新对话。");
			return;
		}
		if (
			settings.mode === "pi" &&
			(!settings.enabledTools.includes("pi_agent_harness") ||
				!backend.connected ||
				!backend.models.some((model) => model.id === settings.model))
		) {
			setNotice("Pi 模型不可用。请启用 Pi 工具、授权模型并在设置中选择，或切换为本地数据分析。");
			return;
		}
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		const id = conversation?.id ?? crypto.randomUUID();
		const assistantId = crypto.randomUUID();
		const now = new Date().toISOString();
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: text.trim(),
			timestamp: now,
			status: "done",
		};
		const assistant: ChatMessage = {
			id: assistantId,
			role: "assistant",
			content: "",
			timestamp: now,
			status: "streaming",
			engine: settings.mode === "pi" ? `Pi Agent · ${settings.model}` : "本地数据分析",
		};
		setWorkspace((state) => ({
			...state,
			activeId: id,
			conversations: conversation
				? state.conversations.map((item) =>
						item.id === id ? { ...item, time: now, messages: [...item.messages, userMessage, assistant] } : item,
					)
				: [
						{
							id,
							title: text.trim().slice(0, 28),
							time: now,
							deviceId: device.id,
							messages: [userMessage, assistant],
						},
						...state.conversations,
					],
		}));
		const updateReply = (update: (message: ChatMessage) => ChatMessage) =>
			setWorkspace((state) => ({
				...state,
				conversations: state.conversations.map((item) =>
					item.id === id
						? {
								...item,
								messages: item.messages.map((message) =>
									message.id === assistantId ? update(message) : message,
								),
							}
						: item,
				),
			}));
		try {
			const analysis = analyzeLocally(text, device, dataset, settings);
			if (settings.mode === "local") updateReply((message) => ({ ...message, ...analysis, status: "done" }));
			else {
				await streamChat(
					{
						model: settings.model,
						text: text.trim(),
						context: analysis.content,
						history: (conversation?.messages ?? [])
							.filter((message) => message.status === "done")
							.slice(-20)
							.map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
					},
					controller.signal,
					(delta) => updateReply((message) => ({ ...message, content: message.content + delta })),
				);
				updateReply((message) => ({ ...message, status: "done", structuredData: analysis.structuredData }));
			}
		} catch (error) {
			updateReply((message) => ({
				...message,
				status: controller.signal.aborted ? "cancelled" : "error",
				content:
					message.content +
					(controller.signal.aborted ? "" : `\n${error instanceof Error ? error.message : "请求失败"}`),
			}));
		} finally {
			if (request.current === controller) {
				request.current = null;
				setBusy(false);
			}
		}
	};
	const importFile = async (file: File) => {
		setImportError("");
		setImporting(true);
		const targetDevice = device.id;
		try {
			if (file.size > 2 * 1024 * 1024) throw new Error("文件不得超过 2 MB。");
			if (!/\.(csv|log|jsonl)$/iu.test(file.name)) throw new Error("请选择 CSV、LOG 或 JSONL 文件。");
			const data = parseTelemetry(await file.text(), file.name);
			setWorkspace((state) => ({ ...state, datasets: { ...state.datasets, [targetDevice]: data } }));
			setModal(null);
			setNotice(`已为${device.name}导入 ${data.samples.length} 个采样点`);
		} catch (error) {
			setImportError(error instanceof Error ? error.message : "导入失败");
		} finally {
			setImporting(false);
			if (fileInput.current) fileInput.current.value = "";
		}
	};
	const saveSettings = (next: AppSettings) => {
		stop();
		setWorkspace((state) => ({ ...state, settings: next }));
		setModal(null);
		setNotice("配置已应用并保存");
	};
	const toggleTool = (tool: ToolId) =>
		setWorkspace((state) => ({
			...state,
			settings: {
				...state.settings,
				enabledTools: state.settings.enabledTools.includes(tool)
					? state.settings.enabledTools.filter((item) => item !== tool)
					: [...state.settings.enabledTools, tool],
			},
		}));
	const quickAction = (action: string) => {
		const queries: Record<string, string> = {
			generate_report: `生成${device.name}的运行数据分析报表`,
			parse_fault_code: `分析${device.name}的故障排查流程，并说明故障码解析所需信息`,
			device_archive: `查询${device.name}（${device.code}）的设备台账档案`,
			maintenance_advice: `基于当前数据给出${device.name}的维护建议`,
		};
		void sendMessage(queries[action] ?? action);
		setPanelOpen(false);
	};
	const openImport = () => {
		setImportError("");
		setModal("import");
	};
	return (
		<div className="flex h-dvh w-full overflow-hidden bg-[#f4f7fb] text-slate-800 font-sans">
			{(sidebarOpen || panelOpen) && (
				<button
					type="button"
					aria-label="关闭侧边面板"
					className="fixed inset-0 z-30 bg-slate-900/30"
					onClick={() => {
						setSidebarOpen(false);
						setPanelOpen(false);
					}}
				/>
			)}
			<Sidebar
				conversations={[...workspace.conversations].sort((a, b) => b.time.localeCompare(a.time))}
				activeId={workspace.activeId}
				onNewChat={newChat}
				onSelectConversation={(id) => {
					stop();
					const item = workspace.conversations.find((entry) => entry.id === id);
					setWorkspace((state) => ({ ...state, activeId: id, deviceId: item?.deviceId ?? state.deviceId }));
					setSidebarOpen(false);
				}}
				onRename={(id) => {
					setRenameId(id);
					setRenameValue(workspace.conversations.find((item) => item.id === id)?.title ?? "");
				}}
				onDelete={setDeleteId}
				onExport={() =>
					downloadText(
						"DCMA-conversations.json",
						JSON.stringify(workspace.conversations, null, 2),
						"application/json;charset=utf-8",
					)
				}
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
			/>
			<main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
				<Header
					onOpenSettings={() => setModal("settings")}
					onOpenHistory={() => setSidebarOpen(true)}
					onOpenPanel={() => setPanelOpen(true)}
					status={backend}
					settings={settings}
				/>
				<div className="px-4 sm:px-6 text-[11px] text-slate-500 pb-2 flex flex-wrap gap-x-3">
					<span>
						{device.name} · {dataset.source}
					</span>
					{settings.mode === "pi" && !backend.models.length && (
						<span className="text-amber-700">模型尚未授权，请打开设置</span>
					)}
				</div>
				{(notice || storageError) && (
					<output className="block mx-4 mb-2 p-2 rounded-xl bg-amber-50 text-amber-800 text-xs">
						{storageError || notice}
					</output>
				)}
				{conversation ? (
					<ChatView
						messages={conversation.messages}
						isStreaming={busy}
						canExport={settings.enabledTools.includes("auto_report")}
					/>
				) : (
					<WelcomeView
						onSelectSuggestion={(text) => {
							void sendMessage(text);
						}}
					/>
				)}
				<ChatInput
					key={workspace.activeId ?? "new-chat"}
					onSendMessage={(text) => {
						void sendMessage(text);
					}}
					disabled={busy}
					onStop={stop}
					onImport={openImport}
					enabledTools={settings.enabledTools}
					onToggleTool={toggleTool}
				/>
			</main>
			<RightPanel
				device={device}
				metrics={getMetrics(dataset.samples, settings.alarmThreshold)}
				dataset={dataset}
				threshold={settings.alarmThreshold}
				checkedAt={checkedAt}
				intervalMs={settings.telemetryIntervalMs}
				onSwitchDevice={() => setModal("device")}
				onViewMoreTelemetry={() => setModal("telemetry")}
				onQuickAction={quickAction}
				onImport={openImport}
				onRestoreDemo={() => {
					setWorkspace((state) => ({
						...state,
						datasets: { ...state.datasets, [device.id]: createDemoDatasets()[device.id] },
					}));
					setNotice("已切换为示例数据；原始上传文件不会被修改");
				}}
				disabled={busy}
				open={panelOpen}
				onClose={() => setPanelOpen(false)}
			/>
			{modal === "device" && (
				<DeviceModal
					currentDevice={device}
					onClose={() => setModal(null)}
					onSelectDevice={(selected) => {
						stop();
						setWorkspace((state) => ({ ...state, deviceId: selected.id, activeId: null }));
					}}
				/>
			)}
			{modal === "telemetry" && (
				<TelemetryModal
					device={device}
					dataset={dataset}
					threshold={settings.alarmThreshold}
					onClose={() => setModal(null)}
				/>
			)}
			{modal === "settings" && (
				<SettingsModal
					settings={settings}
					backend={backend}
					onClose={() => setModal(null)}
					onSave={saveSettings}
					onRefresh={() => {
						void refreshModels();
					}}
				/>
			)}
			{modal === "import" && (
				<Modal
					title={`导入数据 · ${device.name}`}
					subtitle="文件在本浏览器解析；覆盖当前设备的数据集，其他设备不受影响"
					onClose={() => {
						if (!importing) setModal(null);
					}}
				>
					<p className="text-sm mb-3">
						CSV 列名：timestamp、temperature、vibration、current、speed。时间为 ISO 日期时间；温度单位 ℃、振动
						mm/s、电流 A、转速 rpm。至少需要时间和一个指标。
					</p>
					<p className="text-xs text-slate-500 mb-4">
						LOG / JSONL 支持每行一个含相同字段的 JSON 对象。最大 2 MB、10000 个采样点。当前设备：{device.code}。
					</p>
					<input
						ref={fileInput}
						aria-label="选择监测数据文件"
						type="file"
						accept=".csv,.log,.jsonl"
						disabled={importing}
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) void importFile(file);
						}}
						className="w-full text-sm"
					/>
					{importing && <output className="block mt-3 text-xs">正在解析…</output>}
					{importError && (
						<p role="alert" className="text-red-600 text-sm mt-3">
							{importError}
						</p>
					)}
					<button
						type="button"
						className="text-xs text-blue-600 mt-4"
						onClick={() =>
							downloadText(
								"DCMA-template.csv",
								telemetryCsv([
									{
										timestamp: "2026-10-08T00:00:00Z",
										temperature: 46.8,
										vibration: 0.32,
										current: 312,
										speed: 1498,
									},
									{
										timestamp: "2026-10-08T00:00:01Z",
										temperature: 50.2,
										vibration: 0.34,
										current: 313,
										speed: 1497,
									},
								]),
								"text/csv;charset=utf-8",
							)
						}
					>
						下载 CSV 格式模板
					</button>
				</Modal>
			)}
			{renameId && (
				<Modal title="重命名会话" onClose={() => setRenameId(null)}>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (!renameValue.trim()) return;
							setWorkspace((state) => ({
								...state,
								conversations: state.conversations.map((item) =>
									item.id === renameId ? { ...item, title: renameValue.trim() } : item,
								),
							}));
							setRenameId(null);
						}}
					>
						<input
							className="form-control"
							aria-label="会话名称"
							maxLength={60}
							required
							value={renameValue}
							onChange={(event) => setRenameValue(event.target.value)}
						/>
						<button className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm" type="submit">
							保存名称
						</button>
					</form>
				</Modal>
			)}
			{deleteId && (
				<Modal title="删除会话" subtitle="请先导出需要保留的记录" onClose={() => setDeleteId(null)}>
					<p className="text-sm mb-4">
						删除“{workspace.conversations.find((item) => item.id === deleteId)?.title}”及其消息？
					</p>
					<button
						type="button"
						onClick={() => {
							stop();
							setWorkspace((state) => ({
								...state,
								activeId: state.activeId === deleteId ? null : state.activeId,
								conversations: state.conversations.filter((item) => item.id !== deleteId),
							}));
							setDeleteId(null);
						}}
						className="text-sm bg-red-600 text-white px-4 py-2 rounded-xl"
					>
						确认删除
					</button>
				</Modal>
			)}
		</div>
	);
}
