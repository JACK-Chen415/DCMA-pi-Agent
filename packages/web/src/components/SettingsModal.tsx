import { useEffect, useState } from "react";
import type { AppSettings, BackendStatus } from "../types.ts";
import { DatabasePanel } from "./DatabasePanel";
import { Modal } from "./Modal";
import { ModelApiPanel } from "./ModelApiPanel";
export function SettingsModal({
	settings,
	backend,
	onClose,
	onSave,
	onRefresh,
}: {
	settings: AppSettings;
	backend: BackendStatus;
	onClose: () => void;
	onSave: (settings: AppSettings) => void;
	onRefresh: () => Promise<void>;
}) {
	const [draft, setDraft] = useState(settings);
	const modelUnavailable = !backend.connected || !backend.models.length;
	useEffect(() => {
		if (backend.models.some((item) => item.id === draft.model)) return;
		const fallback = backend.models[0]?.id ?? "";
		if (fallback === draft.model) return;
		setDraft((state) => ({ ...state, model: fallback }));
	}, [backend.models, draft.model]);
	return (
		<Modal
			title="系统与诊断核心设置"
			subtitle="模型与 API 配置保存到本机后端；其它设置保存在本浏览器"
			onClose={onClose}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSave(draft);
				}}
				className="space-y-5 text-sm"
			>
				<p className="text-xs text-slate-500">
					{backend.message}
					<button
						type="button"
						onClick={() => {
							void onRefresh();
						}}
						className="ml-2 text-blue-600"
					>
						重新读取全部模型
					</button>
				</p>
				<ModelApiPanel
					providers={backend.providers ?? []}
					models={backend.models}
					model={draft.model}
					onModelChange={(id) => setDraft((state) => ({ ...state, model: id }))}
					onRefresh={onRefresh}
				/>
				<label className="flex items-start gap-2 text-xs">
					<input
						type="checkbox"
						checked={draft.databaseEnabled !== false}
						onChange={(event) => setDraft({ ...draft, databaseEnabled: event.target.checked })}
					/>
					Agent 优先查询 MySQL（结果来自数据库工具，失败时不使用示例替代）
				</label>
				<DatabasePanel />
				<div>
					<p className="mb-2">本地服务状态检查频率</p>
					<div className="grid grid-cols-3 gap-2">
						{[1000, 3000, 5000].map((interval) => (
							<button
								type="button"
								key={interval}
								aria-pressed={draft.telemetryIntervalMs === interval}
								onClick={() => setDraft({ ...draft, telemetryIntervalMs: interval })}
								className={`rounded-xl border py-2 ${draft.telemetryIntervalMs === interval ? "border-blue-600 bg-blue-50 text-blue-600" : "border-slate-200"}`}
							>
								{interval / 1000}s
							</button>
						))}
					</div>
					<p className="text-xs text-slate-500 mt-2">导入数据保持原始采样值，检查频率不会生成或修改测量值。</p>
				</div>
				<label className="block">
					温度警戒阈值（℃）
					<input
						className="form-control"
						type="number"
						min="0"
						max="150"
						step="0.1"
						required
						value={draft.alarmThreshold}
						onChange={(event) => setDraft({ ...draft, alarmThreshold: Number(event.target.value) })}
					/>
				</label>
				<p className="text-xs text-slate-500">
					模型 API
					配置保存在本机后端（.dcma-runtime/model-providers.json），其他浏览器打开本页也能看到同一组配置；密钥不会返回浏览器。
				</p>
				<div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
					<button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 rounded-xl">
						取消
					</button>
					<button
						type="submit"
						disabled={!draft.model || modelUnavailable}
						className="px-4 py-2 bg-blue-600 text-white rounded-xl disabled:opacity-40"
					>
						保存并应用
					</button>
				</div>
			</form>
		</Modal>
	);
}
