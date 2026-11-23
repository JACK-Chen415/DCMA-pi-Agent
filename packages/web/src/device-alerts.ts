/** Sources already carry a fresh-state assessment from the server; only fresh non-zero codes count. */
export interface AlertSource {
	table: string;
	assessment?: { state?: string } | undefined;
	latest?: { raw?: { fault_code?: unknown; alarm_code?: unknown } } | null;
}

export interface DeviceAlert {
	table: string;
	state: "fault" | "warning";
	fault: string;
	alarm: string;
}

export const deviceAlertStorageKey = "dcma-device-alert-seen";

function alertCode(value: unknown): string {
	return value === null || value === undefined ? "" : String(value).trim();
}

export function collectDeviceAlerts(sources: readonly AlertSource[] | null | undefined): DeviceAlert[] {
	const alerts: DeviceAlert[] = [];
	for (const source of sources ?? []) {
		const state = source.assessment?.state;
		if (state !== "fault" && state !== "warning") continue;
		alerts.push({
			table: source.table,
			state,
			fault: alertCode(source.latest?.raw?.fault_code),
			alarm: alertCode(source.latest?.raw?.alarm_code),
		});
	}
	return alerts.sort((a, b) => a.table.localeCompare(b.table));
}

/** Stable while the same codes stay active; a new device or code changes it so the dot returns. */
export function deviceAlertSignature(alerts: readonly DeviceAlert[]): string {
	return alerts.map((alert) => `${alert.table}:${alert.state}:${alert.fault}:${alert.alarm}`).join("|");
}

/** Stores the acknowledged signature; damaged values are ignored so the dot falls back to visible. */
export function parseSeenAlertSignature(raw: string | null): string {
	return typeof raw === "string" && raw.length <= 4096 ? raw : "";
}
