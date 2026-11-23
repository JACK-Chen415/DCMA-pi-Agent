import { readFile, rename, writeFile } from "node:fs/promises";

export type ModelSource = "gateway" | "configured";

export interface ProviderSummary {
	id: string;
	name: string;
	baseUrl: string;
	api: string;
	apiKeyHint: string;
	keyConfigured: boolean;
	discoverModels: boolean;
	builtin: boolean;
	overridden: boolean;
	models: string[];
	source: ModelSource;
	error?: string;
}

export interface ProviderInput {
	provider?: unknown;
	name?: unknown;
	baseUrl?: unknown;
	apiKey?: unknown;
	api?: unknown;
	discoverModels?: unknown;
	models?: unknown;
}

export interface ComposedModels {
	path: string;
	providers: ProviderSummary[];
}

interface ModelEntry {
	id: string;
	name?: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
	input?: string[];
	cost?: Record<string, number>;
	contextWindow?: number;
	maxTokens?: number;
	compat?: Record<string, boolean | string>;
	[key: string]: unknown;
}

interface ProviderEntry {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	discoverModels?: boolean;
	models?: ModelEntry[];
	[key: string]: unknown;
}

interface ModelsFile {
	providers: Record<string, ProviderEntry>;
}

interface DiscoveredModel {
	id: string;
	name?: string;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
}

const envPattern = /^\$\{([A-Z0-9_]+)\}$/u;
const providerIdPattern = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const modelIdPattern = /^[\w.:-]{1,120}$/u;
const discoveryTimeoutMs = 4000;
const discoveryCacheTtlMs = 60000;
const maxProviders = 20;
const maxModelsPerProvider = 100;
type DiscoveryCacheEntry = { at: number; models: DiscoveredModel[]; error?: string };
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

function normalizeModelsFile(value: unknown): ModelsFile {
	if (!value || typeof value !== "object") return { providers: {} };
	const providers = (value as { providers?: unknown }).providers;
	if (!providers || typeof providers !== "object") return { providers: {} };
	const result: Record<string, ProviderEntry> = {};
	for (const [id, raw] of Object.entries(providers as Record<string, unknown>)) {
		if (!providerIdPattern.test(id) || !raw || typeof raw !== "object") continue;
		const entry = raw as Record<string, unknown>;
		const models = Array.isArray(entry.models)
			? entry.models.flatMap((item: unknown) => {
					if (!item || typeof item !== "object") return [];
					const model = item as Record<string, unknown>;
					if (typeof model.id !== "string" || !modelIdPattern.test(model.id)) return [];
					return [structuredClone(model) as ModelEntry];
				})
			: undefined;
		result[id] = {
			...(structuredClone(entry) as ProviderEntry),
			models,
		};
	}
	return { providers: result };
}

function parseJsonFile(content: string): unknown {
	return JSON.parse(content.replace(/^\uFEFF/u, "")) as unknown;
}

export async function readProviderStore(path: string): Promise<ModelsFile> {
	try {
		return normalizeModelsFile(parseJsonFile(await readFile(path, "utf8")));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return { providers: {} };
		throw new Error(`模型 API 配置文件无法读取：${error instanceof Error ? error.message : String(error)}`);
	}
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
	await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await rename(`${path}.tmp`, path);
}

export function resolveApiKey(configured: string | undefined): string | undefined {
	if (!configured) return undefined;
	const match = envPattern.exec(configured);
	if (!match) return configured;
	const value = process.env[match[1] ?? ""];
	return value ? value : undefined;
}

export function maskApiKey(configured: string | undefined): string {
	if (!configured) return "未配置";
	const match = envPattern.exec(configured);
	if (match) {
		const name = match[1] ?? "";
		const value = process.env[name];
		return value ? `环境变量 ${name}（${value.slice(0, 4)}…${value.slice(-4)}）` : `环境变量 ${name}（未设置）`;
	}
	const resolved = resolveApiKey(configured);
	return resolved ? `${resolved.slice(0, 4)}…${resolved.slice(-4)}` : "未配置";
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function readModelsFromPayload(payload: unknown): unknown[] {
	if (!payload || typeof payload !== "object") return [];
	const data = (payload as { data?: unknown; models?: unknown }).data ?? (payload as { models?: unknown }).models;
	if (Array.isArray(data)) return data;
	return Array.isArray(payload) ? payload : [];
}

function parseDiscoveredModel(value: unknown): DiscoveredModel | undefined {
	if (!value || typeof value !== "object") return undefined;
	const entry = value as Record<string, unknown>;
	const id = asString(entry.id) ?? asString(entry.model) ?? asString(entry.name);
	if (!id || !modelIdPattern.test(id)) return undefined;
	const rawInput = Array.isArray(entry.input) ? entry.input : [];
	const input = rawInput.filter((item): item is string => item === "text" || item === "image");
	return {
		id,
		name: asString(entry.name) ?? asString(entry.display_name),
		input: input.length ? input : undefined,
		contextWindow:
			asPositiveNumber(entry.context_window) ??
			asPositiveNumber(entry.context_length) ??
			asPositiveNumber(entry.max_context_tokens) ??
			asPositiveNumber(entry.max_model_len),
		maxTokens:
			asPositiveNumber(entry.max_output_tokens) ??
			asPositiveNumber(entry.max_tokens) ??
			asPositiveNumber(entry.max_completion_tokens),
	};
}

function describeFailure(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const status = /^HTTP (\d{3})$/u.exec(message)?.[1];
	if (status === "401" || status === "403") return `密钥被拒绝（HTTP ${status}）`;
	if (status) return `接口返回错误（HTTP ${status}）`;
	if (message === "密钥未配置") return message;
	return `无法读取模型列表：${message}`;
}

async function discoverProviderModels(provider: ProviderEntry, signal: AbortSignal): Promise<DiscoveredModel[]> {
	const baseUrl = provider.baseUrl?.replace(/\/+$/u, "");
	if (!baseUrl) throw new Error("缺少接口地址");
	const apiKey = resolveApiKey(provider.apiKey);
	if (!apiKey) throw new Error("密钥未配置");
	const response = await fetch(`${baseUrl}/models`, {
		headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
		signal: AbortSignal.any([signal, AbortSignal.timeout(discoveryTimeoutMs)]),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const models: DiscoveredModel[] = [];
	const seen = new Set<string>();
	for (const item of readModelsFromPayload(await response.json())) {
		const model = parseDiscoveredModel(item);
		if (!model || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
		if (models.length >= maxModelsPerProvider) break;
	}
	if (!models.length) throw new Error("接口没有返回可用模型");
	return models;
}

function modelDefaults(model: DiscoveredModel): ModelEntry {
	return {
		id: model.id,
		name: model.name ?? model.id,
		reasoning: false,
		input: model.input ?? ["text"],
		contextWindow: model.contextWindow ?? 131072,
		maxTokens: model.maxTokens ?? 16384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
		},
	};
}

function mergeDiscoveredModels(configured: ModelEntry[] | undefined, discovered: DiscoveredModel[]): ModelEntry[] {
	const base = configured ?? [];
	return discovered.map((model) => {
		const matched = base.find((entry) => entry.id === model.id);
		if (!matched) return modelDefaults(model);
		return {
			...matched,
			name: model.name ?? matched.name,
			input: model.input ?? matched.input,
			contextWindow: model.contextWindow ?? matched.contextWindow,
			maxTokens: model.maxTokens ?? matched.maxTokens,
		};
	});
}

function withModelDefaults(provider: ProviderEntry): ProviderEntry {
	const models = provider.models?.map((model) => {
		const defaults = modelDefaults({ id: model.id });
		return {
			...defaults,
			...model,
			cost: { ...defaults.cost, ...model.cost },
			compat: { ...defaults.compat, ...model.compat },
		};
	});
	return { ...provider, models };
}

function applyEntry(from: ProviderEntry | undefined, input: Record<string, unknown>, models: ModelEntry[] | undefined) {
	const next: ProviderEntry = { ...(from ?? {}) };
	const name = asString(input.name);
	if (name) next.name = name;
	next.baseUrl = input.baseUrl as string;
	next.api = (input.api as string) ?? "openai-completions";
	next.discoverModels = input.discoverModels === true;
	const apiKey = asString(input.apiKey);
	if (apiKey) next.apiKey = apiKey;
	if (models) next.models = models;
	else if (!next.models) next.models = [];
	next.updatedAt = new Date().toISOString();
	return next;
}

export type ValidatedProvider =
	| { ok: true; value: Record<string, unknown>; models?: ModelEntry[] }
	| { ok: false; error: string };

export function validateProviderInput(input: ProviderInput): ValidatedProvider {
	if (!input || typeof input !== "object") return { ok: false, error: "请求格式无效" };
	const provider = asString(input.provider) ?? "";
	if (!providerIdPattern.test(provider))
		return { ok: false, error: "API 名称需为 1-32 位小写字母、数字或连字符，例如 lab 或 deepseek-official" };
	const baseUrl = asString(input.baseUrl) ?? "";
	if (!baseUrl) return { ok: false, error: "请填写接口基础地址，例如 http://10.108.13.250:18081/v1" };
	if (!/^https?:\/\/\S+$/u.test(baseUrl) || baseUrl.length > 300)
		return { ok: false, error: "接口地址需以 http:// 或 https:// 开头，且不超过 300 个字符" };
	if (/\/chat\/completions\/?$/u.test(baseUrl))
		return { ok: false, error: "接口地址填基础地址，不要包含 /chat/completions" };
	const api = asString(input.api) ?? "openai-completions";
	if (api !== "openai-completions") return { ok: false, error: "目前仅支持 OpenAI 兼容（Chat Completions）接口" };
	const apiKey = asString(input.apiKey) ?? "";
	if (apiKey && (apiKey.length < 8 || apiKey.length > 512 || /\s/u.test(apiKey)))
		return { ok: false, error: "密钥需为 8-512 个不含空白的字符" };
	const name = asString(input.name);
	if (name && name.length > 60) return { ok: false, error: "显示名称不得超过 60 个字符" };
	const discoverModels = input.discoverModels === undefined ? true : input.discoverModels === true;
	const rawModels = Array.isArray(input.models)
		? input.models.flatMap((item: unknown) => {
				if (typeof item !== "string") return [];
				const id = item.trim();
				return id ? [id] : [];
			})
		: [];
	for (const id of rawModels) {
		if (!modelIdPattern.test(id)) return { ok: false, error: `模型名称格式无效：${id}` };
	}
	if (rawModels.length > maxProviders) return { ok: false, error: "模型数量过多" };
	if (!discoverModels && !rawModels.length) return { ok: false, error: "关闭自动读取后，请至少填写一个模型名称" };
	return {
		ok: true,
		value: {
			provider,
			name: name ?? undefined,
			baseUrl: baseUrl.replace(/\/+$/u, ""),
			api,
			apiKey: apiKey || undefined,
			discoverModels,
		},
		models: rawModels.length ? rawModels.map((id) => ({ id })) : undefined,
	};
}

/** Canonical form without save timestamps or implicit defaults, so an unchanged save does not count as an override. */
function canonicalProvider(provider: ProviderEntry | undefined): string {
	if (!provider) return "";
	const visit = (value: unknown): string => {
		if (Array.isArray(value)) return `[${value.map(visit).join(",")}]`;
		if (value && typeof value === "object") {
			const entries = Object.entries(value as Record<string, unknown>)
				.filter(([key, item]) => key !== "updatedAt" && item !== undefined && item !== false)
				.sort(([a], [b]) => a.localeCompare(b));
			return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${visit(item)}`).join(",")}}`;
		}
		return JSON.stringify(value) ?? "null";
	};
	return visit(provider);
}

export async function saveProvider(
	storePath: string,
	builtinPath: string,
	input: ProviderInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const validated = validateProviderInput(input);
	if (!validated.ok) return validated;
	const store = await readProviderStore(storePath);
	const builtin = normalizeModelsFile(parseJsonFile(await readFile(builtinPath, "utf8")));
	const providerId = validated.value.provider as string;
	if (
		!store.providers[providerId] &&
		!builtin.providers[providerId] &&
		Object.keys(store.providers).length >= maxProviders
	)
		return { ok: false, error: `最多保存 ${maxProviders} 个 API 配置` };
	const existing = store.providers[providerId] ?? builtin.providers[providerId];
	const previousModels = existing?.models;
	const models = validated.models
		? validated.models.map((model) => {
				const matched = previousModels?.find((entry) => entry.id === model.id);
				return matched ?? model;
			})
		: existing?.models;
	const next = applyEntry(existing, validated.value, models);
	const builtinEntry = builtin.providers[providerId];
	if (builtinEntry && canonicalProvider(next) === canonicalProvider(builtinEntry)) delete store.providers[providerId];
	else store.providers[providerId] = next;
	await writeAtomic(storePath, store);
	discoveryCache.delete(providerId);
	return { ok: true };
}

export async function deleteProvider(
	storePath: string,
	provider: string,
): Promise<{ ok: true; restored: boolean } | { ok: false; error: string }> {
	if (!providerIdPattern.test(provider)) return { ok: false, error: "API 名称无效" };
	const store = await readProviderStore(storePath);
	if (!store.providers[provider]) return { ok: false, error: "该 API 没有被界面修改过，无需恢复" };
	delete store.providers[provider];
	await writeAtomic(storePath, store);
	discoveryCache.delete(provider);
	return { ok: true, restored: true };
}

/** Composes builtin models.json plus UI-saved providers, discovers model lists, writes models.effective.json. */
export async function composeEffectiveModels(options: {
	builtinPath: string;
	storePath: string;
	effectivePath: string;
	refresh?: "all" | string[];
	signal?: AbortSignal;
}): Promise<ComposedModels> {
	const builtin = normalizeModelsFile(parseJsonFile(await readFile(options.builtinPath, "utf8")));
	const store = await readProviderStore(options.storePath);
	const signal = options.signal ?? new AbortController().signal;
	const forceAll = options.refresh === "all";
	const forceProviders = Array.isArray(options.refresh) ? new Set(options.refresh) : new Set<string>();
	const ids = [
		...Object.keys(builtin.providers),
		...Object.keys(store.providers).filter((id) => !builtin.providers[id]),
	];
	const effective: ModelsFile = { providers: {} };
	const summaries = new Map<string, ProviderSummary>();
	await Promise.all(
		ids.map(async (providerId) => {
			const builtinEntry = builtin.providers[providerId];
			const storedEntry = store.providers[providerId];
			const unchanged =
				!!builtinEntry && !!storedEntry && canonicalProvider(storedEntry) === canonicalProvider(builtinEntry);
			const configured = storedEntry && !unchanged ? storedEntry : builtinEntry;
			const baseUrl = configured?.baseUrl?.replace(/\/+$/u, "") ?? "";
			const api = configured?.api ?? "openai-completions";
			const apiKey = resolveApiKey(configured?.apiKey);
			const discoverModels = configured?.discoverModels === true;
			const summary: ProviderSummary = {
				id: providerId,
				name: configured?.name ?? providerId,
				baseUrl,
				api,
				apiKeyHint: maskApiKey(configured?.apiKey),
				keyConfigured: !!apiKey,
				discoverModels,
				builtin: !!builtinEntry,
				overridden: !!builtinEntry && !!storedEntry && !unchanged,
				models: (configured?.models ?? []).map((model) => model.id),
				source: "configured",
			};
			if (!configured) return;
			if (!baseUrl || !apiKey || api !== "openai-completions") {
				summary.error = !baseUrl ? "缺少接口地址" : !apiKey ? "密钥未配置" : "非 OpenAI 兼容接口";
				effective.providers[providerId] = withModelDefaults(configured);
				summaries.set(providerId, summary);
				return;
			}
			const mustDiscover = discoverModels || forceAll || forceProviders.has(providerId);
			const cached = discoveryCache.get(providerId);
			const cachedFresh = cached && Date.now() - cached.at < discoveryCacheTtlMs;
			if (discoverModels && !mustDiscover && cachedFresh) {
				if (cached.error) {
					summary.error = cached.error;
					effective.providers[providerId] = withModelDefaults(configured);
				} else {
					summary.models = cached.models.map((model) => model.id);
					summary.source = "gateway";
					effective.providers[providerId] = withModelDefaults({
						...configured,
						models: mergeDiscoveredModels(configured.models, cached.models),
					});
				}
				summaries.set(providerId, summary);
				return;
			}
			if (!discoverModels) {
				effective.providers[providerId] = withModelDefaults(configured);
				summaries.set(providerId, summary);
				return;
			}
			try {
				const discovered = await discoverProviderModels(configured, signal);
				discoveryCache.set(providerId, { at: Date.now(), models: discovered });
				summary.models = discovered.map((model) => model.id);
				summary.source = "gateway";
				effective.providers[providerId] = withModelDefaults({
					...configured,
					models: mergeDiscoveredModels(configured.models, discovered),
				});
			} catch (error) {
				const message = describeFailure(error);
				discoveryCache.set(providerId, { at: Date.now(), models: [], error: message });
				summary.error = message;
				effective.providers[providerId] = withModelDefaults(configured);
			}
			summaries.set(providerId, summary);
		}),
	);
	await writeAtomic(options.effectivePath, effective);
	return {
		path: options.effectivePath,
		providers: ids.flatMap((id) => {
			const summary = summaries.get(id);
			return summary ? [summary] : [];
		}),
	};
}
