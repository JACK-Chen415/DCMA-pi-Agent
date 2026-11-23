import assert from "node:assert/strict";
import test from "node:test";
import {
	type AlertSource,
	collectDeviceAlerts,
	deviceAlertSignature,
	parseSeenAlertSignature,
} from "../src/device-alerts.ts";

function source(table: string, state: string, fault = "0", alarm = "0"): AlertSource {
	return { table, assessment: { state }, latest: { raw: { fault_code: fault, alarm_code: alarm } } };
}

test("only fresh fault or warning states become device alerts", () => {
	const alerts = collectDeviceAlerts([
		source("real_data_02", "fault", "F30002"),
		source("real_data_01", "warning", "0", "A1"),
		source("real_data_03", "running"),
		source("real_data_04", "unknown"),
		{ table: "sim_normal" },
	]);
	assert.deepEqual(
		alerts.map((alert) => [alert.table, alert.state, alert.fault, alert.alarm]),
		[
			["real_data_01", "warning", "0", "A1"],
			["real_data_02", "fault", "F30002", "0"],
		],
	);
});

test("the signature is stable for the same polling data and changes with new anomalies", () => {
	const first = collectDeviceAlerts([source("real_data_02", "fault", "F30002")]);
	const same = collectDeviceAlerts([source("real_data_02", "fault", "F30002")]);
	const changed = collectDeviceAlerts([source("real_data_02", "fault", "F30011")]);
	const extraDevice = collectDeviceAlerts([
		source("real_data_02", "fault", "F30002"),
		source("real_data_01", "warning", "0", "A1"),
	]);
	assert.equal(deviceAlertSignature(first), deviceAlertSignature(same));
	assert.notEqual(deviceAlertSignature(first), deviceAlertSignature(changed));
	assert.notEqual(deviceAlertSignature(first), deviceAlertSignature(extraDevice));
	assert.equal(deviceAlertSignature([]), "");
});

test("acknowledged signatures survive but damaged storage values are ignored", () => {
	assert.equal(parseSeenAlertSignature(null), "");
	assert.equal(parseSeenAlertSignature(""), "");
	assert.equal(parseSeenAlertSignature("real_data_02:fault:F30002:0"), "real_data_02:fault:F30002:0");
	assert.equal(parseSeenAlertSignature("x".repeat(5000)), "");
});
