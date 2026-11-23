import { useEffect, useRef, useState } from "react";
import { deleteModelProvider, getModelConfig, saveModelProvider } from "../api.ts";
import type { ModelProviderStatus } from "../types.ts";

interface Draft {
	provider: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	discoverModels: boolean;
	modelsText: string;
}
const emptyDraft: Draft = { provider: "", name: "", baseUrl: "", apiKey: "", discoverModels: true, modelsText: "" };

export function ModelApiPanel({
	providers,
	models,
	model,
	onModelChange,
	onRefresh,
}: {
	providers: ModelProviderStatus[];
	models: { id: string; name: string }[];
	model: string;
	onModelChange: (id: string) => void;
	onRefresh: () => Promise<void>;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft>(emptyDraft);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const editor = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (editing === null) return;
		const onPointer = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (editor.current?.contains(target)) return;
			setEditing(null);
		};
		window.addEventListener("mousedown", onPointer);
		return () => window.removeEventListener("mousedown", onPointer);
	}, [editing]);

	const grouped = providers
		.map((provider) => ({
			provider,
			items: models.filter((item) => item.id.startsWith(`${provider.id}/`)),
		}))
		.filter((group) => group.items.length);
	const orphans = models.filter((item) => !providers.some((provider) => item.id.startsWith(`${provider.id}/`)));

	const apply = async (task: () => Promise<{ message: string }>, key: string) => {
		setBusy(key);
		setError("");
		setNotice("");
		try {
			const result = await task();
			setNotice(result.message);
			await onRefresh();
			return true;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "模型 API 操作失败");
			return false;
		} finally {
			setBusy("");
		}
	};

	const startEdit = (provider: ModelProviderStatus | null) => {
		setError("");
		setNotice("");
		setConfirmDelete(null);
		if (!provider) {
			setEditing("");
			setDraft(emptyDraft);
			return;
		}
		setEditing(provider.id);
		setDraft({
			provider: provider.id,
			name: provider.name === provider.id ? "" : provider.name,
			baseUrl: provider.baseUrl,
			apiKey: "",
			discoverModels: provider.discoverModels,
			modelsText: provider.models.join(", "),
		});
	};

	const submit = async () => {
		const models2 = draft.modelsText
			.split(/[,，\s]+/u)
			.map((item) => item.trim())
			.filter(Boolean);
		const saving = await apply(async () => {
			const result = await saveModelProvider({
				provider: draft.provider.trim(),
				name: draft.name.trim() || undefined,
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim() || undefined,
				discoverModels: draft.discoverModels,
				models: draft.discoverModels ? undefined : models2,
			});
			const saved = result.providers.find((item) => item.id === draft.provider.trim());
			return {
				message: saved?.error
					? `已保存 ${draft.provider.trim()}，但模型列表未读取：${saved.error}`
					: `已保存 ${draft.provider.trim()}：${saved?.models.length ?? 0} 个模型可用`,
			};
		}, "save");
		if (saving) setEditing(null);
	};

	return (
		<section className="space-y-3">
			<div>
				<p className="font-medium">模型选择</p>
				<select
					className="form-control mt-2"
					value={model}
					disabled={!models.length}
					onChange={(event) => onModelChange(event.target.value)}
				>
					<option value="">{models.length ? "请选择模型" : "暂无可用模型，请先配置模型 API"}</option>
					{grouped.map((group) => (
						<optgroup key={group.provider.id} label={`${group.provider.name}（${group.provider.id}）`}>
							{group.items.map((item) => (
								<option value={item.id} key={item.id}>
									{item.name}
								</option>
							))}
						</optgroup>
					))}
					{!!orphans.length && (
						<optgroup label="其它">
							{orphans.map((item) => (
								<option value={item.id} key={item.id}>
									{item.name}
								</option>
							))}
						</optgroup>
					)}
				</select>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<p className="font-medium">模型 API 配置</p>
					<button type="button" className="text-xs text-blue-600" onClick={() => startEdit(null)}>
						新增 API
					</button>
				</div>
				<p className="text-xs text-slate-500">
					每个 API
					独立保存接口地址、密钥与模型；保存或读取后立即生效，无需重启服务。详细配置在编辑窗口中修改，密钥只保存在本机后端。
				</p>
				{providers.map((provider) => (
					<div key={provider.id} className="rounded-xl border border-slate-200 p-3 text-xs space-y-1">
						<div className="flex flex-wrap items-start justify-between gap-2">
							<div className="min-w-0">
								<p className="font-medium text-slate-800">
									{provider.name} <span className="font-normal text-slate-500">（{provider.id}）</span>
									<span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
										{provider.builtin ? (provider.overridden ? "内置 · 已修改" : "内置") : "自定义"}
									</span>
									{!provider.keyConfigured && (
										<span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
											未配置密钥
										</span>
									)}
								</p>
								<p className={provider.error ? "text-amber-700" : "text-slate-600"}>
									{provider.error
										? `未读取模型：${provider.error}`
										: `模型：${provider.models.join("、") || "无"}`}
								</p>
							</div>
							<div className="flex shrink-0 flex-wrap items-center gap-2">
								<button
									type="button"
									className="text-blue-600"
									disabled={busy !== ""}
									onClick={() =>
										void apply(async () => {
											const result = await getModelConfig(undefined, provider.id);
											const entry = result.providers.find((item) => item.id === provider.id);
											return {
												message: entry?.error
													? `${provider.id} 读取失败：${entry.error}`
													: `${provider.id} 已读取 ${entry?.models.length ?? 0} 个模型`,
											};
										}, `read-${provider.id}`)
									}
								>
									{busy === `read-${provider.id}` ? "读取中…" : "读取模型"}
								</button>
								<button type="button" className="text-blue-600" onClick={() => startEdit(provider)}>
									编辑
								</button>
								{(!provider.builtin || provider.overridden) && (
									<button type="button" className="text-red-600" onClick={() => setConfirmDelete(provider.id)}>
										{provider.builtin ? "恢复默认" : "删除"}
									</button>
								)}
							</div>
						</div>
						{confirmDelete === provider.id && (
							<div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2 py-1.5 text-red-700">
								<span>{provider.builtin ? "恢复内置配置并丢弃界面修改？" : "删除该 API 配置？"}</span>
								<button
									type="button"
									disabled={busy !== ""}
									onClick={() =>
										void apply(async () => {
											const result = await deleteModelProvider(provider.id);
											setConfirmDelete(null);
											return {
												message: provider.builtin
													? `${provider.id} 已恢复内置配置`
													: `已删除 ${provider.id}，现有 ${result.models.length} 个模型可用`,
											};
										}, `delete-${provider.id}`)
									}
								>
									确认
								</button>
								<button type="button" onClick={() => setConfirmDelete(null)}>
									取消
								</button>
							</div>
						)}
					</div>
				))}
				{editing !== null && (
					<div ref={editor} className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-xs space-y-2">
						<p className="font-medium">{editing ? `编辑 API：${editing}` : "新增 API"}</p>
						<div className="grid gap-2 sm:grid-cols-2">
							<label className="block">
								API 名称（唯一，小写字母/数字/连字符）
								<input
									className="form-control"
									value={draft.provider}
									disabled={!!editing}
									onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
									placeholder="例如 lab / deepseek-official"
								/>
							</label>
							<label className="block">
								显示名称（可选）
								<input
									className="form-control"
									value={draft.name}
									onChange={(event) => setDraft({ ...draft, name: event.target.value })}
									placeholder="例如 实验室网关"
								/>
							</label>
						</div>
						<label className="block">
							接口基础地址（OpenAI 兼容 Chat Completions，保留 /v1）
							<input
								className="form-control"
								value={draft.baseUrl}
								onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
								placeholder="例如 http://10.108.13.250:18081/v1"
							/>
						</label>
						<label className="block">
							密钥{editing ? "（留空表示不修改）" : ""}
							<input
								className="form-control"
								type="password"
								autoComplete="off"
								value={draft.apiKey}
								onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
								placeholder={editing ? "粘贴新密钥可替换，留空保持原密钥" : "粘贴 API Key"}
							/>
						</label>
						<label className="flex items-start gap-2">
							<input
								type="checkbox"
								checked={draft.discoverModels}
								onChange={(event) => setDraft({ ...draft, discoverModels: event.target.checked })}
							/>
							保存后自动读取该接口的 /models 可用模型列表
						</label>
						{!draft.discoverModels && (
							<label className="block">
								模型名称（逗号或空格分隔）
								<input
									className="form-control"
									value={draft.modelsText}
									onChange={(event) => setDraft({ ...draft, modelsText: event.target.value })}
									placeholder="例如 deepseek-flash, deepseek-chat"
								/>
							</label>
						)}
						<div className="flex items-center gap-3">
							<button
								type="button"
								className="rounded-xl bg-blue-600 px-3 py-1.5 text-white disabled:opacity-40"
								disabled={busy !== ""}
								onClick={() => void submit()}
							>
								{busy === "save" ? "保存中…" : "保存并读取模型"}
							</button>
							<button type="button" className="text-slate-500" onClick={() => setEditing(null)}>
								取消
							</button>
						</div>
					</div>
				)}
			</div>
			{notice && <output className="block text-xs text-emerald-700">{notice}</output>}
			{error && (
				<p role="alert" className="text-xs text-red-600">
					{error}
				</p>
			)}
		</section>
	);
}
