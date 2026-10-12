import { useEffect, useState } from "react";
import type { DashboardHistory, DashboardRange, DashboardTable } from "./database-types.ts";

export function useSampleHistory(table: DashboardTable, limit: 50 | 100 | 200, range: DashboardRange | null, page: number) {
	const [reload, setReload] = useState(0);
	const [state, setState] = useState<{ key: string; data: DashboardHistory | null; loading: boolean; error: string }>({ key: "", data: null, loading: false, error: "" });
	const key = range ? `${table}/${limit}/${range.from}/${range.to}/${page}` : "";
	useEffect(() => {
		if (!range) { setState({ key: "", data: null, loading: false, error: "" }); return; }
		let active = true;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 65000);
		setState((current) => ({ key, data: current.key === key ? current.data : null, loading: true, error: "" }));
		void (async () => {
			try {
				const parameters = new URLSearchParams({ table, limit: String(limit), page: String(page), from: range.from, to: range.to });
				const response = await fetch(`/api/database/sample-history?${parameters}`, { signal: controller.signal });
				const body = await response.json();
				if (!response.ok) throw new Error(body.error || "历史采样查询失败。");
				if (body.table !== table || body.limit !== limit || body.page !== page || body.from !== range.from || body.to !== range.to) throw new Error("历史采样与当前查询条件不一致。");
				if (active) setState({ key, data: body as DashboardHistory, loading: false, error: "" });
			} catch (error) {
				if (active) setState((current) => ({ ...current, loading: false, error: error instanceof Error && error.name !== "AbortError" ? error.message : "历史采样查询超时，请重试。" }));
			} finally { clearTimeout(timeout); }
		})();
		return () => { active = false; clearTimeout(timeout); controller.abort(); };
	}, [table, limit, range, page, reload, key]);
	return { data: state.key === key ? state.data : null, loading: !!range && (state.key !== key || state.loading), error: state.key === key ? state.error : "", refresh: () => setReload((value) => value + 1) };
}
