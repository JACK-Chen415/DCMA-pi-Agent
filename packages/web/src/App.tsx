import { useCallback, useEffect, useRef, useState } from "react";
import { cancelChat, getBackendStatus, streamChat } from "./api.ts";
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
import { createConversationStorage } from "./conversation-storage.ts";
import { dashboardTables, databaseDataset, databaseDevice, databaseMetrics, useDashboard } from "./dashboard-data.ts";
import { downloadText, exportStatusEvent } from "./download.ts";
import { createMessageId } from "./message-id.ts";
import { loadWorkspace, storageKey } from "./storage.ts";
import { getMetrics, parseTelemetry, telemetryCsv } from "./telemetry.ts";
import type { AppSettings, BackendStatus, ChatMessage } from "./types.ts";

export function App() {
	const [workspace, setWorkspace] = useState(loadWorkspace);
	const [backend, setBackend] = useState<BackendStatus>({ connected: false, models: [], message: "正在连接本地服务" });
	const [modal, setModal] = useState<"device" | "telemetry" | "settings" | "import" | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [panelOpen, setPanelOpen] = useState(false);
	const [notice, setNotice] = useState("");
	const [storageError, setStorageError] = useState("");
	const [historyError, setHistoryError] = useState("");
	const [historyReady, setHistoryReady] = useState(false);
	const [historyAttempt, setHistoryAttempt] = useState(0);
	const [importError, setImportError] = useState("");
	const [importing, setImporting] = useState(false);
	const [renameId, setRenameId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const requests = useRef(new Map<string, { controller: AbortController; assistantId: string }>());
	const fileInput = useRef<HTMLInputElement>(null);
	const workspaceRef = useRef(workspace);
	workspaceRef.current = workspace;
	const historyStorage = useRef<ReturnType<typeof createConversationStorage> | null>(null);
	const table = dashboardTables.find((item) => item === workspace.deviceId) ?? dashboardTables[0];
	const live = useDashboard(table, 100);
	const devices = dashboardTables.map((name) =>
		databaseDevice(
			name,
			live.data?.sources.find((source) => source.table === name),
			live.error ||
				(workspace.offlineDeviceId === name && workspace.datasets[name]?.imported
					? "当前为离线导入数据，无法确认实时状态"
					: ""),
		),
	);
	const device = devices.find((item) => item.id === table)!;
	const offline = workspace.offlineDeviceId === table && !!workspace.datasets[table]?.imported;
	const dataset = offline ? workspace.datasets[table] : databaseDataset(table, live.data);
	const dataMessage = live.error
		? `${live.data ? "刷新失败，保留上次成功数据。" : "未取得数据库数据。"}${live.error}`
		: live.data?.sources.find((source) => source.table === table)?.message || live.update;
	const checkedAt = live.data ? new Date(live.data.queriedAt).toLocaleString("zh-CN") : "尚未查询成功";
	const conversation = workspace.conversations.find((item) => item.id === workspace.activeId);
	const generatingConversations = workspace.conversations.filter((item) =>
		item.messages.some((message) => message.role === "assistant" && message.status === "streaming"),
	);
	const busy = generatingConversations.length > 0;
	const isStreaming = generatingConversations.some((item) => item.id === workspace.activeId);
	const settings = workspace.settings;
	const followReply = useCallback(
		async (id: string, assistantId: string, controller: AbortController, payload?: unknown) => {
			const updateReply = (update: (message: ChatMessage) => ChatMessage) => {
				if (requests.current.get(id)?.controller !== controller) return;
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
			};
			try {
				const status = await streamChat(
					payload,
					controller.signal,
					(delta) => updateReply((message) => ({ ...message, content: message.content + delta })),
					(chart) =>
						updateReply((message) => ({
							...message,
							charts: (message.charts ?? []).some((item) => item.id === chart.id)
								? message.charts
								: [...(message.charts ?? []), chart].slice(0, 3),
						})),
					(text, charts) => updateReply((message) => ({ ...message, content: text, charts, status: "streaming" })),
					payload === undefined ? assistantId : undefined,
					(steps) => updateReply((message) => ({ ...message, steps })),
				);
				updateReply((message) => ({ ...message, status }));
			} catch (error) {
				updateReply((message) => ({
					...message,
					status: controller.signal.aborted ? "cancelled" : "error",
					content:
						message.content +
						(controller.signal.aborted ? "" : `\n${error instanceof Error ? error.message : "请求失败"}`),
				}));
			} finally {
				if (requests.current.get(id)?.controller === controller) requests.current.delete(id);
			}
		},
		[],
	);

	useEffect(() => {
		if (historyAttempt > 0) setHistoryReady(false);
		let active = true;
		const storage = createConversationStorage(setHistoryError);
		historyStorage.current = storage;
		setHistoryError("");
		void storage
			.load(workspaceRef.current)
			.then((saved) => {
				if (!active) return;
				setWorkspace((state) => ({ ...state, ...saved }));
				setHistoryReady(true);
			})
			.catch((error: unknown) => {
				if (active) setHistoryError(error instanceof Error ? error.message : "聊天记录读取失败，请重试。");
			});
		return () => {
			active = false;
			storage.dispose();
		};
	}, [historyAttempt]);
	useEffect(() => {
		if (historyReady) historyStorage.current?.update(workspace, busy);
	}, [workspace, busy, historyReady]);
	useEffect(() => {
		if (!historyReady) return;
		const timer = setTimeout(() => {
			try {
				localStorage.setItem(storageKey, JSON.stringify(workspace));
				setStorageError("");
			} catch {
				setStorageError("浏览器缓存写入失败，设置或导入数据可能无法恢复。聊天记录会另行保存到本机，可导出备份。");
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [workspace, historyReady]);
	useEffect(() => {
		if (!historyReady) return;
		const save = () => {
			try {
				localStorage.setItem(storageKey, JSON.stringify(workspaceRef.current));
			} catch {
				// Server persistence does not depend on the browser cache.
			}
			void historyStorage.current?.flush(true);
		};
		window.addEventListener("pagehide", save);
		return () => window.removeEventListener("pagehide", save);
	}, [historyReady]);
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
	useEffect(() => {
		const active = requests.current;
		return () => {
			for (const { controller } of active.values()) controller.abort();
			active.clear();
		};
	}, []);
	useEffect(() => {
		if (!historyReady) return;
		for (const item of workspaceRef.current.conversations) {
			if (requests.current.has(item.id)) continue;
			const message = item.messages.find((entry) => entry.status === "streaming" && entry.role === "assistant");
			if (!message) continue;
			const controller = new AbortController();
			requests.current.set(item.id, { controller, assistantId: message.id });
			void followReply(item.id, message.id, controller);
		}
	}, [historyReady, followReply]);
	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(""), 7000);
		return () => clearTimeout(timer);
	}, [notice]);
	useEffect(() => {
		const exported = (event: Event) => {
			if (event instanceof CustomEvent && typeof event.detail === "string") setNotice(event.detail);
		};
		window.addEventListener(exportStatusEvent, exported);
		return () => window.removeEventListener(exportStatusEvent, exported);
	}, []);

	const stop = (conversationId = workspaceRef.current.activeId) => {
		const request = conversationId ? requests.current.get(conversationId) : undefined;
		if (!request) return;
		void cancelChat(request.assistantId)
			.then(() => request.controller.abort())
			.catch((error: unknown) => {
				setNotice(error instanceof Error ? error.message : "停止生成失败，请重试。");
			});
	};
	const newChat = () => {
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
		const workspace = workspaceRef.current;
		const conversation = workspace.conversations.find((item) => item.id === workspace.activeId);
		if (
			!text.trim() ||
			(conversation &&
				(requests.current.has(conversation.id) ||
					conversation.messages.some((message) => message.status === "streaming")))
		)
			return;
		if (workspace.conversations.length >= 50 && !conversation) {
			setNotice("最多保留 50 个会话，请先导出并删除不需要的会话。");
			return;
		}
		if ((conversation?.messages.length ?? 0) >= 198) {
			setNotice("当前会话已达到 200 条消息，请开启新对话。");
			return;
		}
		if (!backend.connected || !backend.models.some((model) => model.id === settings.model)) {
			setNotice("DCMA 模型不可用。请授权模型并在设置中选择。");
			return;
		}
		const controller = new AbortController();
		let id = conversation?.id ?? "";
		let assistantId = "";
		try {
			id ||= createMessageId();
			assistantId = createMessageId();
			requests.current.set(id, { controller, assistantId });
			const now = new Date().toISOString();
			const userMessage: ChatMessage = {
				id: createMessageId(),
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
				engine: `DCMA Agent · ${settings.model}`,
			};
			const next = {
				...workspace,
				activeId: id,
				conversations: conversation
					? workspace.conversations.map((item) =>
							item.id === id
								? { ...item, time: now, messages: [...item.messages, userMessage, assistant] }
								: item,
						)
					: [
							{
								id,
								title: text.trim().slice(0, 28),
								time: now,
								deviceId: device.id,
								messages: [userMessage, assistant],
							},
							...workspace.conversations,
						],
			};
			workspaceRef.current = next;
			setWorkspace(next);
			await historyStorage.current?.checkpoint(next);
			controller.signal.throwIfAborted();
			const databasePreferred = !offline || settings.databaseEnabled !== false;
			await followReply(id, assistantId, controller, {
				requestId: assistantId,
				model: settings.model,
				text: text.trim(),
				context: databasePreferred
					? JSON.stringify({
							schema: "dcma",
							table,
							device: device.name,
							source: table === "real_data" ? "历史真实采集" : "模拟数据",
							note: "当前设备与展板使用同一数据源，请通过数据库工具重新查询；状态码未解码，不得推断运行状态。位置和投运日期未提供。",
						})
					: JSON.stringify({
							device,
							source: dataset.source,
							imported: dataset.imported,
							alarmThreshold: settings.alarmThreshold,
							units: { temperature: "℃", vibration: "mm/s", current: "A", speed: "rpm" },
							totalSamples: dataset.samples.length,
							samples: dataset.samples.slice(-200),
							note: "导入文件属于离线数据，仅提供最新最多200个采样点，不代表数据库当前读数或全量统计。",
						}),
				database: databasePreferred,
				table,
				history: (conversation?.messages ?? [])
					.filter((message) => message.status === "done")
					.slice(-20)
					.map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
			});
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "消息发送失败，请重试。");
			setWorkspace((state) => ({
				...state,
				conversations: state.conversations.map((item) =>
					item.id === id
						? {
								...item,
								messages: item.messages.map((message) =>
									message.id === assistantId
										? {
												...message,
												status: controller.signal.aborted ? "cancelled" : "error",
												content: error instanceof Error ? error.message : "请求失败",
											}
										: message,
								),
							}
						: item,
				),
			}));
		} finally {
			if (requests.current.get(id)?.controller === controller) requests.current.delete(id);
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
			setWorkspace((state) => ({
				...state,
				offlineDeviceId: targetDevice,
				datasets: { ...state.datasets, [targetDevice]: data },
			}));
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
	if (!historyReady)
		return (
			<main className="min-h-dvh bg-[#f4f7fb] p-8 text-slate-800">
				<output>{historyError || "正在恢复本机聊天记录…"}</output>
				{historyError && (
					<div className="flex gap-4 mt-4">
						<button
							type="button"
							className="text-blue-600"
							onClick={() => setHistoryAttempt((attempt) => attempt + 1)}
						>
							重试读取
						</button>
						<button
							type="button"
							className="text-blue-600"
							onClick={() =>
								downloadText(
									"DCMA-conversations.json",
									JSON.stringify(workspace.conversations, null, 2),
									"application/json;charset=utf-8",
								)
							}
						>
							导出浏览器中的会话
						</button>
					</div>
				)}
			</main>
		);
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
				/>
				<div className="px-4 sm:px-6 text-[11px] text-slate-500 pb-2 flex flex-wrap gap-x-3">
					<span>
						{device.name} · {dataset.source}
					</span>
					<span>{offline ? "当前为离线导入数据；展板使用 MySQL" : "Agent 与展板使用同一 MySQL 数据来源"}</span>
					{!backend.models.length && <span className="text-amber-700">模型尚未授权，请打开设置</span>}
				</div>
				{(notice || storageError || historyError) && (
					<output className="block mx-4 mb-2 p-2 rounded-xl bg-amber-50 text-amber-800 text-xs">
						{historyError || storageError || notice}
					</output>
				)}
				{conversation ? (
					<ChatView
						messages={conversation.messages}
						isStreaming={isStreaming}
						onRequery={(text) => {
							void sendMessage(text);
						}}
					/>
				) : (
					<WelcomeView
						onSelectSuggestion={(text) => {
							void sendMessage(text);
						}}
					/>
				)}
				{busy && !isStreaming && (
					<output className="mx-4 text-xs text-slate-500">
						{generatingConversations.length} 个会话正在后台生成，可在当前会话继续提问。
					</output>
				)}
				<ChatInput
					key={workspace.activeId ?? "new-chat"}
					onSendMessage={(text) => {
						void sendMessage(text);
					}}
					disabled={isStreaming}
					onStop={isStreaming ? () => stop() : undefined}
					onImport={openImport}
				/>
			</main>
			<RightPanel
				device={device}
				metrics={offline ? getMetrics(dataset.samples, settings.alarmThreshold) : databaseMetrics(live.data)}
				dataset={dataset}
				threshold={settings.alarmThreshold}
				checkedAt={checkedAt}
				intervalMs={3000}
				databaseMessage={offline ? undefined : dataMessage}
				onSwitchDevice={() => setModal("device")}
				onViewMoreTelemetry={() => {
					stop();
					try {
						localStorage.setItem(storageKey, JSON.stringify(workspace));
					} catch {
						setNotice("会话尚未保存，请先导出会话后再打开展板。");
						return;
					}
					window.location.assign(`/dashboard/?table=${table}#realtime`);
				}}
				onQuickAction={quickAction}
				onImport={openImport}
				onRestoreDemo={() => {
					setWorkspace((state) => ({ ...state, offlineDeviceId: undefined }));
					setNotice("已返回数据库数据；原始上传文件不会被修改");
				}}
				disabled={isStreaming}
				open={panelOpen}
				onClose={() => setPanelOpen(false)}
			/>
			{modal === "device" && (
				<DeviceModal
					currentDevice={device}
					devices={devices}
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
				<Modal title="重命名会话" size="compact" onClose={() => setRenameId(null)}>
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
						<div className="flex items-center justify-between gap-3 mb-2">
							<label htmlFor="conversation-name" className="text-sm font-medium text-slate-700">
								会话名称
							</label>
							<span id="conversation-name-count" className="text-xs tabular-nums text-slate-400">
								{renameValue.length}/60
							</span>
						</div>
						<input
							id="conversation-name"
							className="form-control"
							aria-label="会话名称"
							aria-describedby="conversation-name-count"
							maxLength={60}
							required
							value={renameValue}
							onChange={(event) => setRenameValue(event.target.value)}
						/>
						<div className="conversation-dialog-actions">
							<button className="conversation-dialog-cancel" type="button" onClick={() => setRenameId(null)}>
								取消
							</button>
							<button
								className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
								type="submit"
								disabled={!renameValue.trim()}
							>
								保存
							</button>
						</div>
					</form>
				</Modal>
			)}
			{deleteId && (
				<Modal title="删除会话" size="compact" onClose={() => setDeleteId(null)}>
					<p className="text-sm leading-6 text-slate-600">
						确定删除以下会话及其所有消息？请先导出需要保留的记录。
					</p>
					<p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium leading-6 text-slate-800 break-words [overflow-wrap:anywhere]">
						{workspace.conversations.find((item) => item.id === deleteId)?.title}
					</p>
					<div className="conversation-dialog-actions">
						<button className="conversation-dialog-cancel" type="button" onClick={() => setDeleteId(null)}>
							取消
						</button>
						<button
							type="button"
							onClick={() => {
								stop(deleteId);
								setWorkspace((state) => ({
									...state,
									activeId: state.activeId === deleteId ? null : state.activeId,
									conversations: state.conversations.filter((item) => item.id !== deleteId),
								}));
								setDeleteId(null);
							}}
							className="bg-red-600 text-white hover:bg-red-700"
						>
							确认删除
						</button>
					</div>
				</Modal>
			)}
		</div>
	);
}
