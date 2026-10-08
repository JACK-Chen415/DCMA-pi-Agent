import { useEffect, useRef, useState } from "react";
import type { DatabaseCatalog, DatabaseRows, DatabaseTable } from "../database-types.ts";

export function DatabasePanel() {
	const [catalog, setCatalog] = useState<DatabaseCatalog | null>(null);
	const [data, setData] = useState<DatabaseRows | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const pending = useRef<AbortController | null>(null);
	useEffect(() => () => pending.current?.abort(), []);
	const load = async (table?: DatabaseTable) => {
		if (pending.current) return;
		const controller = new AbortController();
		pending.current = controller;
		setLoading(true);
		setError("");
		setData(null);
		try {
			const query = table ? new URLSearchParams({ schema: table.schema, table: table.name, limit: "20" }) : null;
			const response = await fetch(query ? `/api/database/rows?${query}` : "/api/database/catalog?refresh=1", {
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
			});
			if (!response.ok) throw new Error("数据库查询失败，请检查校园网/VPN及 MySQL 服务。");
			if (table) setData((await response.json()) as DatabaseRows);
			else setCatalog((await response.json()) as DatabaseCatalog);
		} catch (reason) {
			if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "数据库查询失败");
		} finally {
			if (pending.current === controller) {
				pending.current = null;
				setLoading(false);
			}
		}
	};
	return (
		<section aria-label="工业数据库连接" className="rounded-xl border border-slate-200 p-3 space-y-3">
			<div className="flex justify-between gap-2 items-center">
				<h3 className="font-bold">工业 MySQL 数据库</h3>
				<button
					type="button"
					className="text-blue-600 text-xs"
					disabled={loading}
					onClick={() => {
						void load();
					}}
				>
					{loading ? "正在读取…" : "检查连接与表结构"}
				</button>
			</div>
			<p className="text-xs text-slate-500">
				real_data_01–04：实时模拟；real_data：短暂真实采集。账号与密码仅由后端读取。
			</p>
			<output className="block text-xs">
				{error || catalog?.message || "尚未检查连接。需要校园网或对应 VPN 可达后端数据库。"}
			</output>
			{catalog?.checkedAt && (
				<p className="text-[11px] text-slate-500">
					检查时间：{new Date(catalog.checkedAt).toLocaleString("zh-CN")}
				</p>
			)}
			{catalog?.tables.map((table) => (
				<div key={`${table.schema}.${table.name}`} className="text-xs border-t border-slate-100 pt-2">
					<button
						type="button"
						disabled={loading}
						className="text-blue-600 break-all"
						onClick={() => {
							void load(table);
						}}
					>
						{table.schema}.{table.name} · {table.label} · 读取20行
					</button>
					<p className="text-slate-500 mt-1 break-all">
						字段：{table.columns.map((column) => `${column.name} (${column.type})`).join("、")}
					</p>
				</div>
			))}
			{data && (
				<div>
					<p className="text-xs">
						{data.table.label} · 返回 {data.returned} 行{data.hasMore && "（还有更多数据）"}
					</p>
					<p className="text-[11px] text-slate-500">{data.note}</p>
					<pre className="mt-2 text-[11px] bg-slate-50 rounded-lg p-2 max-h-48 overflow-auto">
						{JSON.stringify(data.rows, null, 2)}
					</pre>
				</div>
			)}
		</section>
	);
}
