import type { NumericField } from "../../../dashboard/database/dashboard-types.ts";
import { type MetricCondition, readMetricAggregates } from "../../../dashboard/database/database.ts";
import { type AnalysisRange, ToolInputError, validateRange } from "./contracts.ts";

export async function loadMetricSummary(
	range: AnalysisRange,
	metrics: NumericField[],
	signal: AbortSignal,
	bucketSeconds?: number,
	condition?: MetricCondition,
) {
	range = validateRange(range);
	const from = Date.parse(range.from),
		to = Date.parse(range.to);
	const targetBuckets = metrics.length <= 4 ? 168 : Math.max(1, Math.floor(600 / metrics.length));
	const step = to - from > 86400000 ? 3600 : 60;
	bucketSeconds ??= Math.max(step, Math.ceil((to - from) / 1000 / targetBuckets / step) * step);
	if (!Number.isFinite(bucketSeconds) || bucketSeconds <= 0 || Math.ceil((to - from) / 1000 / bucketSeconds) > 200)
		throw new ToolInputError("汇总时段超过200个或间隔无效，请增大汇总时间间隔。");
	const data = await readMetricAggregates({ ...range, metrics, bucketSeconds, condition }, signal);
	const total = data.rows.find((row) => row.bucket === null);
	const records = Number(total?.records ?? 0);
	const instant = (value: unknown) =>
		value === null || value === undefined ? null : new Date(Number(value)).toISOString();
	const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
	return {
		...range,
		schema: "dcma",
		kind: range.table === "real_data" ? "acquired" : "simulation",
		device: data.device,
		queriedAt: data.queriedAt,
		complete: true as const,
		sampled: false,
		calculation: "mysql_aggregate_v1",
		snapshot: "single_read_only_transaction",
		timeInterpretation: "Asia/Shanghai_provisional",
		unitsVerified: false,
		availableFields: data.availableFields,
		missingFields: metrics.filter((metric) => !data.availableFields.includes(metric)),
		records,
		coverage: {
			firstSampleAt: instant(total?.first_at),
			lastSampleAt: instant(total?.last_at),
			timeValidRecords: records,
		},
		invalidTimeRowsInSource: data.invalidTimeRows,
		invalidTimeRangeAttribution: "unknown",
		excludedIdentityRows: data.excludedIdentityRows,
		metrics: metrics.map((metric, index) => {
			const key = `m${index}`;
			const count = Number(total?.[`${key}_count`] ?? 0);
			const endpoints = data.endpoints
				.filter((row) => row[key] !== null)
				.sort((a, b) => Number(a.__collection_ms) - Number(b.__collection_ms));
			const endpoint = (row: (typeof endpoints)[number] | undefined) =>
				row ? { at: instant(row.__collection_ms)!, value: Number(row[key]) } : null;
			const first = endpoint(endpoints[0]),
				last = endpoint(endpoints.at(-1));
			const duration = first && last ? (Date.parse(last.at) - Date.parse(first.at)) / 1000 : 0;
			return {
				metric,
				count,
				missing: records - count,
				zeros: Number(total?.[`${key}_zeros`] ?? 0),
				mean: number(total?.[`${key}_mean`]),
				populationStdDev: number(total?.[`${key}_stddev`]),
				min: number(total?.[`${key}_min`]),
				max: number(total?.[`${key}_max`]),
				first,
				last,
				slopePerSecond: first && last && duration > 0 ? (last.value - first.value) / duration : null,
				slopeMethod: "first_to_last_unique_timestamp",
			};
		}),
		condition: condition
			? {
					...condition,
					matched: Number(total?.matched ?? 0),
					valid: Number(total?.[`m${metrics.indexOf(condition.metric)}_count`] ?? 0),
					missing: records - Number(total?.[`m${metrics.indexOf(condition.metric)}_count`] ?? 0),
					notMatched:
						Number(total?.[`m${metrics.indexOf(condition.metric)}_count`] ?? 0) - Number(total?.matched ?? 0),
					meaning: "采样点数，不是连续事件次数",
				}
			: null,
		bucketSeconds,
		bucketBoundary: "left_closed_right_open_except_range_end",
		trend: {
			columns: [
				"from",
				"records",
				...metrics.flatMap((metric) => [`${metric}.count`, `${metric}.mean`, `${metric}.min`, `${metric}.max`]),
			],
			rows: Array.from({ length: data.bucketCount }, (_, index) => {
				const row = data.rows.find((item) => item.bucket !== null && Number(item.bucket) === index);
				return [
					new Date(from + index * bucketSeconds! * 1000).toISOString(),
					Number(row?.records ?? 0),
					...metrics.flatMap((_, index) => [
						Number(row?.[`m${index}_count`] ?? 0),
						number(row?.[`m${index}_mean`]),
						number(row?.[`m${index}_min`]),
						number(row?.[`m${index}_max`]),
					]),
				];
			}),
			meaning: "按时间段汇总全部原始采样；缺失数=records-count；没有采样的时段为null，不补0，不是逐条采样曲线",
		},
	};
}

export type MetricSummary = Awaited<ReturnType<typeof loadMetricSummary>>;
