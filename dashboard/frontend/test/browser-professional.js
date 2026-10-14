async (page) => {
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const base = await (await page.request.get("http://127.0.0.1:3000/api/database/dashboard?table=real_data_01&limit=100")).json();
	let fail = false;
	const open = { id: "open/1", field: "fault_code", code: "F01030", startedAt: "2026-01-14T10:20:37.005Z", endedAt: null, lastSeenAt: "2026-01-14T10:27:24.814Z", samples: 2, ending: null, startUncertain: false, hasMissingSamples: true };
	await page.route("**/api/database/dashboard?**", async (route) => {
		const url = new URL(route.request().url()), data = structuredClone(base);
		data.table = url.searchParams.get("table"); data.limit = Number(url.searchParams.get("limit"));
		data.queriedAt = "2026-10-14T07:00:00.000Z";
		data.latest.acquiredAt = data.table === "real_data" ? open.lastSeenAt : "2026-10-14T06:59:56.000Z";
		data.latest.raw.device_name = `核对标识 · ${data.table}`;
		await route.fulfill({ status: fail ? 503 : 200, contentType: "application/json", body: JSON.stringify(fail ? { error: "读取失败验收" } : data) });
	});
	await page.route("**/api/database/code-history?**", async (route) => {
		const url = new URL(route.request().url());
		await route.fulfill({ contentType: "application/json", body: JSON.stringify({ table: url.searchParams.get("table"), page: Number(url.searchParams.get("page")), pageSize: 50, total: 1, faults: 1, alarms: 0, open: 1, invalidTimes: 0, queriedAt: "2026-10-14T07:00:00Z", events: [open], codes: [{ field: open.field, code: open.code, count: 1, durationMs: 407809 }] }) });
	});
	try {
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.goto("http://127.0.0.1:3000/#settings/device"); await page.reload();
		const devices = page.getByRole("region", { name: "设备配置", exact: true });
		check(await devices.locator("tbody tr").count() === 5, "设备来源映射缺项");
		check((await devices.innerText()).includes("尚未确认") && (await devices.innerText()).includes("尚未读取"), "尚未确认的铭牌或未查询数据未明确显示");
		await page.getByRole("link", { name: "实时数据", exact: true }).click();
		await page.getByRole("heading", { name: "核对标识 · real_data_01", exact: true }).waitFor();
		check(await page.locator(".sample-age").innerText() === "查询时距采集：4秒", "样本年龄未采用查询快照时间");
		check(await page.locator(".source-context").innerText() === "模拟采样 · 功能验证", "模拟用途缺失");
		await page.getByLabel("数据来源", { exact: true }).selectOption("history");
		await page.getByRole("heading", { name: "核对标识 · real_data", exact: true }).waitFor();
		check(await page.locator(".source-context").innerText() === "历史记录 · 非当前工况", "历史记录仍被作为当前工况");
		check((await page.locator(".sample-age").innerText()).includes("天"), "历史样本年龄缺失");
		check((await page.locator(".time-grid").innerText()).includes("历史记录 · 定期检查"), "历史刷新成功被混同为实时采集");
		fail = true; await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.getByText(/读取失败验收/).waitFor();
		check((await page.locator(".time-grid").innerText()).includes("历史记录读取失败"), "读取失败时显示成功");
		check((await page.locator(".sample-age").innerText()).includes("天"), "失败时丢失上次样本年龄");
		fail = false;
		await page.getByRole("link", { name: "故障与报警", exact: true }).click();
		const row = page.locator(".code-event-table tbody tr");
		await row.waitFor();
		check((await row.innerText()).includes("未观察到结束") && (await row.innerText()).includes("最后观察：2026/01/14 18:27:24.814"), "未结束事件观察口径或末端时间缺失");
		check((await page.locator(".code-event-table thead").innerText()).includes("观察时长"), "观察跨度被称为精确持续时间");
		await row.getByRole("button", { name: "查看前后趋势", exact: true }).waitFor();
		for (const width of [375, 768, 1366, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto("http://127.0.0.1:3000/#settings/device");
			check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}设备来源页横向溢出`);
			check(await devices.locator("tbody tr").count() === 5, "来源快照丢失");
			if ([375, 1366].includes(width)) await devices.screenshot({ path: `output/playwright/professional-device-${width}.png` });
		}
		return "PASS: 来源用途、查询快照样本年龄、失败保留、未确认设备信息、五来源核对、未结束观察口径和四档布局";
	} finally {
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.goto("http://127.0.0.1:3000/#realtime"); await page.reload();
	}
}
