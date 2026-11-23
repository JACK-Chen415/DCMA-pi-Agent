import type { BackendStatus } from "./types.ts";

const defaultModel = "deepseek/deepseek-flash";

export function resolveModel(saved: string, models: BackendStatus["models"]): string {
	if (saved && models.some((model) => model.id === saved)) return saved;
	return models.some((model) => model.id === defaultModel) ? defaultModel : "";
}
