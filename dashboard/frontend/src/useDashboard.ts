import { useEffect, useRef, useState } from "react";
import type { DashboardData, DashboardTable } from "./database-types.ts";
import { sampleIdentity } from "./dashboard-view.ts";

export function useDashboard(table: DashboardTable, limit: 50 | 100 | 200, enabled = true) {
	const [state, setState] = useState<{ key: string; data: DashboardData | null; loading: boolean; error: string; update: string }>({ key: "", data: null, loading: true, error: "", update: "等待首次查询" });
	const refresh = useRef<() => void>(() => {});
	const key = `${table}/${limit}`;
	useEffect(() => {
		if (!enabled) { refresh.current = () => {}; return; }
		let active = true;
		let busy = false;
		let previous: DashboardData | null = null;
		let controller: AbortController | null = null;
		setState({ key, data: null, loading: true, error: "", update: "等待首次查询" });
		const request = async () => {
			if (!active || busy) return;
			busy = true;
			controller = new AbortController();
			const timeout = setTimeout(() => controller?.abort(), 18000);
			setState((current) => ({ ...current, loading: true }));
			try {
				const response = await fetch(`/api/database/dashboard?table=${table}&limit=${limit}`, { signal: controller.signal });
				const body = await response.json();
				if (!response.ok) throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "查询失败，请检查后端服务。");
				const data = body as DashboardData;
				if (data.table !== table || data.limit !== limit) throw new Error("接口返回的来源与当前选择不一致。");
				if (!active) return;
				const update = !data.latest ? "暂无采样记录" : !previous ? "首次读取完成，等待下次检查" : sampleIdentity(data.latest) === sampleIdentity(previous.latest) ? "本次无新采样" : "检测到新采样";
				previous = data;
				setState({ key, data, loading: false, error: "", update });
			} catch (error) {
				if (active) setState((current) => ({ ...current, loading: false, error: error instanceof Error && error.name !== "AbortError" ? error.message : "查询超时，请检查服务后重试。", update: "本次采集更新检查失败" }));
			} finally {
				clearTimeout(timeout);
				busy = false;
			}
		};
		refresh.current = () => void request();
		void request();
		const timer = setInterval(() => void request(), 3000);
		return () => { active = false; clearInterval(timer); controller?.abort(); };
	}, [key, table, limit, enabled]);
	return { ...(state.key === key ? state : { data: null, loading: true, error: "", update: "等待首次查询" }), refresh: () => refresh.current() };
}
