type Data = Record<string, unknown>;

/** Bound detail while preserving full-window measurements and event aggregates. */
export function diagnosticPreview(value: unknown, maxBytes: number): unknown {
	const result = value as Data;
	const statistics = { ...(result.statistics as Data) };
	const events = { ...(result.events as Data) };
	const preview = { ...result, statistics, events };
	const oversized = () => Buffer.byteLength(JSON.stringify(preview)) > maxBytes;
	if (!oversized()) return result;

	// These records were already delivered in this turn and remain independently addressable.
	if (Array.isArray(result.references))
		Object.assign(preview, {
			references: result.references.map(({ id, tool }: Data) => ({ id, tool })),
		});

	if (oversized() && Array.isArray(events.events) && events.events.length) {
		const original = events.events as Data[];
		let retained = original;
		do {
			retained = retained.slice(0, Math.floor(retained.length / 2));
			events.events = retained;
			events.eventsTruncated = true;
			events.hasMore = true;
			events.eventDetailScope = {
				...(events.eventDetailScope as Data),
				returned: retained.length,
				coversAllEvents: false,
				firstStartedAt: retained[0]?.startedAt ?? null,
				lastStartedAt: retained.at(-1)?.startedAt ?? null,
			};
			events.eventScopeNotice = `证据预览保留 ${retained.length} 条事件明细，事件总数及各代码汇总仍覆盖完整查询时段。`;
		} while (retained.length && oversized());
	}

	const trend = statistics.trend as Data | undefined;
	if (oversized() && Array.isArray(trend?.rows) && trend.rows.length) {
		let rows = trend.rows;
		do {
			rows = rows.length > 2 ? rows.filter((_, index) => index % 2 === 0 || index === rows.length - 1) : [];
			statistics.trend = {
				...trend,
				rows,
				sampled: true,
				samplingNote: "预览仅保留部分汇总时段，完整窗口统计不受影响。",
			};
		} while (rows.length && oversized());
	}
	return preview;
}
