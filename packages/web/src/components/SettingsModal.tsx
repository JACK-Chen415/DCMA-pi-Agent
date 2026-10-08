import { useState } from "react";
import type { AppSettings, BackendStatus } from "../types.ts";
import { Modal } from "./Modal";
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
	onRefresh: () => void;
}) {
	const [draft, setDraft] = useState(settings);
	const piUnavailable = !backend.connected || !backend.models.length;
	return (
		<Modal title="系统与诊断核心设置" subtitle="保存后应用到当前工作台，并保存在本浏览器" onClose={onClose}>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSave(draft);
				}}
				className="space-y-5 text-sm"
			>
				<label className="block">
					分析模式
					<select
						className="form-control"
						value={draft.mode}
						onChange={(event) =>
							setDraft({
								...draft,
								mode: event.target.value === "pi" ? "pi" : "local",
								model: draft.model || backend.models[0]?.id || "",
							})
						}
					>
						<option value="local">本地数据分析（无需模型授权）</option>
						<option value="pi" disabled={piUnavailable}>
							Pi Agent 模型对话{piUnavailable ? "（尚未授权模型）" : ""}
						</option>
					</select>
				</label>
				<p className="text-xs text-slate-500">
					{backend.message}
					<button type="button" onClick={onRefresh} className="ml-2 text-blue-600">
						刷新模型列表
					</button>
				</p>
				<label className="block">
					Pi Agent 模型
					<select
						className="form-control"
						value={draft.model}
						disabled={draft.mode !== "pi" || piUnavailable}
						onChange={(event) => setDraft({ ...draft, model: event.target.value })}
					>
						<option value="">请选择已授权模型</option>
						{backend.models.map((model) => (
							<option value={model.id} key={model.id}>
								{model.name}
							</option>
						))}
					</select>
				</label>
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
					Pi 模型读取本机 Pi 授权配置或服务器环境变量。可在终端启动 Pi 并用 /login
					授权，随后刷新模型列表；密钥不发送到浏览器。
				</p>
				<div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
					<button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 rounded-xl">
						取消
					</button>
					<button
						type="submit"
						disabled={draft.mode === "pi" && (!draft.model || piUnavailable)}
						className="px-4 py-2 bg-blue-600 text-white rounded-xl disabled:opacity-40"
					>
						保存并应用
					</button>
				</div>
			</form>
		</Modal>
	);
}
