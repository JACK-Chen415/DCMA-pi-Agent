import type { DashboardSource, DeviceAssessment } from "../../../dashboard/database/dashboard-types.ts";
import { fieldLabels } from "../../../dashboard/database/dashboard-types.ts";
import { assessDeviceState } from "./analytics.ts";
import type { StateRuleSet } from "./contracts.ts";
import type { createKnowledgeService } from "./knowledge.ts";

/** A current-state decision lasts at most 60 seconds from collection, never from refresh. */
export function assessDeviceSource(source: DashboardSource, now: number, rules?: StateRuleSet): DeviceAssessment {
	const latest = source.latest;
	const result: DeviceAssessment = {
		state: "unknown",
		label: "状态未确认",
		tone: "neutral",
		detail: "",
		latestAt: latest?.acquiredAt ?? null,
		assessedAt: new Date(now).toISOString(),
		expiresAt: null,
	};
	if (source.table === "real_data")
		return { ...result, label: "历史采集", detail: "历史采集记录不代表设备当前状态。" };
	if (!source.available) return { ...result, detail: "数据源不可读取，无法确认当前状态。" };
	if (source.message) return { ...result, detail: source.message };
	if (!latest) return { ...result, detail: "暂无采样记录。" };
	const time = latest.acquiredAt ? Date.parse(latest.acquiredAt) : Number.NaN;
	if (!Number.isFinite(time)) return { ...result, detail: "采集时间无法解析。" };
	if (time > now) return { ...result, detail: "采集时间晚于当前时间，请核对采集端时钟。" };
	if (now - time > 60000)
		return { ...result, label: "数据已过期", detail: "最新采样超过60秒未更新，不能确认当前状态。" };
	if (source.latestTimestampAmbiguous !== false)
		return {
			...result,
			detail: source.latestTimestampAmbiguous
				? "最新采集时间存在重复记录，状态可能冲突。"
				: "最新采样唯一性尚未确认。",
		};
	result.expiresAt = new Date(time + 60000).toISOString();
	const fault = latest.raw.fault_code === null ? "" : String(latest.raw.fault_code).trim();
	const alarm = latest.raw.alarm_code === null ? "" : String(latest.raw.alarm_code).trim();
	const codes = `故障码：${fault.slice(0, 128) || "缺失"}；报警码：${alarm.slice(0, 128) || "缺失"}。`;
	if (fault && fault !== "0")
		return {
			...result,
			state: "fault",
			label: "故障码非零",
			tone: "danger",
			detail: `${codes}按展板约定提示故障码，具体原因需查手册，不代表已确认根因。`,
		};
	if (alarm && alarm !== "0")
		return {
			...result,
			state: "warning",
			label: "报警码非零",
			tone: "warning",
			detail: `${codes}按展板约定提示报警码，不推断运行或停机。`,
		};
	if (rules) {
		// The dashboard queried the latest two records and established a unique latest timestamp.
		// This exact-timestamp window therefore contains the complete one-record observation.
		const evaluated = assessDeviceState(
			{
				table: source.table,
				from: latest.acquiredAt!,
				to: latest.acquiredAt!,
				queriedAt: result.assessedAt,
				records: [latest],
				invalidTimeRows: 0,
				excludedIdentityRows: 0,
				complete: true,
				availableFields: Object.keys(fieldLabels),
			},
			60,
			now,
			rules,
		);
		result.ruleSource = { source: rules.source, version: rules.version };
		if (
			evaluated.currentState === "running" ||
			evaluated.currentState === "stopped" ||
			evaluated.currentState === "fault"
		) {
			return {
				...result,
				state: evaluated.currentState,
				label:
					evaluated.currentState === "running"
						? "运行中"
						: evaluated.currentState === "stopped"
							? "已停机"
							: "规则判定故障",
				tone:
					evaluated.currentState === "fault"
						? "danger"
						: evaluated.currentState === "running"
							? "success"
							: "info",
				detail: `${codes}依据已配置规则 ${rules.version} 唯一匹配；不代表整体健康。`,
			};
		}
		return { ...result, detail: `${codes}状态规则未唯一匹配、存在冲突或所需字段缺失。` };
	}
	if (!fault || !alarm) return { ...result, detail: `${codes}故障/报警字段缺失，不能当作0。运行状态尚无判断依据。` };
	return {
		...result,
		label: "未报告故障/报警",
		tone: "info",
		detail: `${codes}仅说明本次采样未报告故障/报警；未配置运行状态规则，不代表运行中或整体健康。`,
	};
}

export async function enrichDeviceStates(
	sources: DashboardSource[],
	knowledge: ReturnType<typeof createKnowledgeService>,
	now = Date.now(),
): Promise<DashboardSource[]> {
	return Promise.all(
		sources.map(async (source) => {
			try {
				const profile = await knowledge.getDeviceProfile(source.table);
				return { ...source, assessment: assessDeviceSource(source, now, profile.stateRules ?? undefined) };
			} catch {
				return {
					...source,
					assessment: {
						state: "unknown" as const,
						label: "状态未确认",
						tone: "neutral" as const,
						detail: "状态配置读取或校验失败；原始采样仍保留。",
						latestAt: source.latest?.acquiredAt ?? null,
						assessedAt: new Date(now).toISOString(),
						expiresAt: null,
					},
				};
			}
		}),
	);
}
