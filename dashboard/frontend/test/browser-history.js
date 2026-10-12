async (page) => {
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const baseline = await (await page.request.get("http://127.0.0.1:3000/api/database/dashboard?table=real_data_01&limit=100")).json();
	const session = await page.context().newCDPSession(page);
	const { windowId, bounds } = await session.send("Browser.getWindowForTarget");
	const records = Array.from({ length: 59 }, (_, index) => ({ id: `fault_code/${index}`, field: "fault_code", code: "F12", startedAt: new Date(Date.UTC(2026, 9, 7, 0, index)).toISOString(), endedAt: new Date(Date.UTC(2026, 9, 7, 0, index, 30)).toISOString(), lastSeenAt: new Date(Date.UTC(2026, 9, 7, 0, index, 20)).toISOString(), samples: 6, ending: "zero", startUncertain: false, hasMissingSamples: false }));
	records.push({ ...records[0], id: "fault_code/old", code: "F01030", startedAt: "2026-10-08T01:00:00.000Z", endedAt: "2026-10-10T02:00:00.000Z", lastSeenAt: "2026-10-10T01:59:59.000Z" });
	records.push({ ...records[0], id: "alarm_code/open", field: "alarm_code", code: "A2062", startedAt: "2026-10-09T01:00:00.000Z", endedAt: null, lastSeenAt: "2026-10-10T02:00:00.000Z", ending: null });
	let mode = "success", release = null;
	const historyRequests = [];
	await page.route("**/api/database/dashboard?**", async (route) => {
		const url = new URL(route.request().url()), data = structuredClone(baseline);
		data.table = url.searchParams.get("table"); data.limit = Number(url.searchParams.get("limit"));
		data.records = data.records.slice(0, 3); data.returned = 3;
		data.latest.raw.device_name = `历史验收 · ${data.table}`;
		await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
	});
	await page.route("**/api/database/code-history?**", async (route) => {
		const url = new URL(route.request().url()), table = url.searchParams.get("table"), current = Number(url.searchParams.get("page"));
		historyRequests.push(url.search);
		const from = url.searchParams.get("from"), to = url.searchParams.get("to");
		const filtered = records.filter((event) => (!to || event.startedAt <= to) && (!from || !event.endedAt || event.endedAt >= from)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		const codes = [...new Set(filtered.map((event) => event.code))].map((code) => ({ field: filtered.find((event) => event.code === code).field, code, count: filtered.filter((event) => event.code === code).length, durationMs: filtered.filter((event) => event.code === code).reduce((total, event) => total + Date.parse(event.endedAt ?? event.lastSeenAt) - Date.parse(event.startedAt), 0) }));
		const result = { table, queriedAt: new Date().toISOString(), page: current, pageSize: 50, total: filtered.length, faults: filtered.filter((event) => event.field === "fault_code").length, alarms: filtered.filter((event) => event.field === "alarm_code").length, open: filtered.filter((event) => !event.endedAt).length, invalidTimes: 0, codes, events: filtered.slice((current - 1) * 50, current * 50) };
		if (mode === "slow" && table === "real_data_02") await new Promise((resolve) => { release = resolve; });
		try { await route.fulfill({ status: mode === "fail" ? 503 : 200, contentType: "application/json", body: JSON.stringify(mode === "fail" ? { error: "历史模拟失败" } : result) }); } catch { /* 已取消旧请求。 */ }
	});
	try {
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.goto("http://127.0.0.1:3000/#codes");
		await page.reload();
		await page.getByRole("button", { name: "查询异常", exact: true }).waitFor();
		check(JSON.stringify(await page.locator(".code-summary-card strong").allTextContents()) === JSON.stringify(["61", "60", "1", "1"]), "历史汇总错误");
		check(await page.locator(".code-event-table tbody tr").count() === 50, "未分页显示全部历史");
		const durations = page.getByRole("region", { name: "历史代码时长分布", exact: true });
		const durationValues = await durations.locator(".code-bar-count").allTextContents();
		for (const [code, expected] of [["F12", "29.5 分"], ["F01030", "2,940 分"], ["A2062", "1,500 分"]]) {
			check(await durations.locator(".code-duration-row").filter({ hasText: code }).locator(".code-bar-count").innerText() === expected, `${code}全历史累计时长、分钟换算或未结束时长错误`);
		}
		check(await durations.locator(".code-duration-bar").first().evaluate((node) => getComputedStyle(node).backgroundColor) === "rgb(37, 99, 235)", "时长条形图未沿用蓝色");
		check(await durations.locator(".code-duration-row").filter({ hasText: "F01030" }).locator(".code-duration-bar").evaluate((node) => node.style.width) === "100%", "最长累计时长未按比例显示");
		const old = page.locator(".code-event-table tbody tr").filter({ hasText: "F01030" });
		check((await old.innerText()).includes("2026/10/08 09:00:00.000") && (await old.innerText()).includes("2026/10/10 10:00:00.000"), "跨窗口事件起止时间缺失");
		check((await old.innerText()).includes("2 天 1 小时"), "持续时间计算错误");
		check((await page.locator(".code-event-table tbody tr").filter({ hasText: "A2062" }).innerText()).includes("未结束"), "未结束事件消失");
		check(await old.locator("td").nth(1).evaluate((node) => getComputedStyle(node).color) === "rgb(185, 28, 28)", "历史故障未标红");
		await page.getByRole("button", { name: "下一页", exact: true }).click();
		await page.getByText("第 2 / 2 页", { exact: true }).waitFor();
		check(await page.locator(".code-event-table tbody tr").count() === 11, "第二页历史错误");
		check(JSON.stringify(await durations.locator(".code-bar-count").allTextContents()) === JSON.stringify(durationValues), "累计时长不应随明细翻页变化");
		await page.getByRole("button", { name: "上一页", exact: true }).click();
		await page.getByRole("button", { name: "查询异常", exact: true }).waitFor();
		for (const limit of ["50", "200", "100"]) {
			await page.getByRole("combobox", { name: "采样条数", exact: true }).selectOption(limit);
			check(await page.locator(".code-event-table tbody tr").count() === 50, "采样条数改变截断历史");
		}
		await page.reload();
		await page.getByRole("button", { name: "查询异常", exact: true }).waitFor();
		check(await old.count() === 1, "刷新丢失历史事件");
		for (const width of [375, 768, 1366, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			await page.evaluate(() => window.scrollTo(0, 0));
			check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}历史页面横向溢出`);
			check(await page.getByRole("region", { name: "历史异常时段", exact: true }).count() === 0, `${width}仍显示历史异常时段`);
			const distribution = page.getByRole("region", { name: "历史代码分布", exact: true });
			check(await distribution.evaluate((node) => Math.abs(node.getBoundingClientRect().width - node.parentElement.querySelector(".device-detail").getBoundingClientRect().width) < 2), `${width}历史代码分布未铺满内容区`);
			await durations.screenshot({ path: `output/playwright/code-duration-${width}.png` });
			if (width === 375 || width === 1366) await page.screenshot({ path: `output/playwright/history-${width}.png`, fullPage: true });
		}
		await page.setViewportSize({ width: 1366, height: 900 });
		const timeInput = (label) => ({ fill: async (value) => {
			const [date, time] = value.split("T");
			await page.getByLabel(`${label}日期`, { exact: true }).fill(date);
			await page.getByLabel(`${label}时间（24小时制）`, { exact: true }).fill(time);
		} });
		const fromInput = timeInput("开始时间（北京时间）"), toInput = timeInput("结束时间（北京时间）");
		await fromInput.fill("2026-10-09T12:00"); await toInput.fill("2026-10-09T13:00");
		await page.getByRole("button", { name: "查询异常", exact: true }).click();
		await page.getByRole("button", { name: "查询异常", exact: true }).waitFor();
		check(await page.locator(".code-event-table tbody tr").count() === 2, "时间筛选没有包含跨边界/未结束事件");
		check(JSON.stringify((await durations.locator(".code-bar-count").allTextContents()).sort()) === JSON.stringify(["2,940 分", "1,500 分"].sort()), "时长筛选应沿用完整匹配事件跨度");
		check((await old.innerText()).includes("2026/10/08 09:00:00.000"), "时间筛选裁掉原始开始时间");
		check(historyRequests.at(-1).includes("2026-10-09T04%3A00%3A00.000Z"), "北京时间筛选未正确转换");
		await fromInput.fill("2026-10-10T12:00");
		const before = historyRequests.length;
		await page.getByRole("button", { name: "查询异常", exact: true }).click();
		await page.getByText("开始时间不能晚于结束时间。", { exact: true }).waitFor();
		check(historyRequests.length === before, "无效时间段仍发起查询");
		await fromInput.fill("2026-10-06T00:00"); await toInput.fill("2026-10-06T23:59");
		await page.getByRole("button", { name: "查询异常", exact: true }).click();
		await page.getByRole("button", { name: "查询异常", exact: true }).waitFor();
		check(await page.locator(".code-event-table tbody tr").count() === 0, "无事件时间段没有清空旧记录");
		check(await durations.locator(".code-duration-row").count() === 0, "空结果仍残留旧时长");
		await page.getByRole("button", { name: "全部时间", exact: true }).click();
		await page.getByRole("button", { name: "查询异常", exact: true }).waitFor();
		check(await page.locator(".code-event-table tbody tr").count() === 50, "全部时间未恢复历史");
		mode = "fail";
		await page.getByRole("button", { name: "查询异常", exact: true }).click();
		await page.getByText(/历史查询失败，保留上次成功结果/).waitFor();
		check(await old.count() === 1, "同选择查询失败丢失历史");
		check(JSON.stringify(await durations.locator(".code-bar-count").allTextContents()) === JSON.stringify(durationValues), "查询失败丢失上次累计时长");
		mode = "slow";
		await page.getByRole("combobox", { name: "查看设备" }).selectOption("2");
		await page.getByRole("button", { name: "查询异常中…", exact: true }).waitFor();
		check(await page.locator(".code-event-table tbody tr").count() === 0, "切设备残留历史");
		check(await durations.locator(".code-duration-row").count() === 0, "切设备残留旧时长");
		await page.getByRole("combobox", { name: "查看设备" }).selectOption("3");
		await page.getByRole("button", { name: "查询异常", exact: true }).waitFor();
		mode = "success"; if (release) release();
		check(historyRequests.at(-1).includes("real_data_03"), "旧历史响应覆盖当前设备");
		console.log("PASS: 全历史代码累计时长/分钟/比例/分页不变/时间筛选、事件起止时间/持续时间、未结束、时间段重叠/北京时间/无效范围/空结果、分页、刷新与采样条数独立、失败保留、设备切换取消、四档布局；数据库未写入。");
	} finally {
		if (release) release();
		try {
			await page.unroute("**/api/database/dashboard?**"); await page.unroute("**/api/database/code-history?**");
			await page.goto("http://127.0.0.1:3000/#codes"); await page.reload();
			await page.locator(".sidebar-footer").filter({ hasText: "数据库查询成功" }).waitFor();
		} finally {
			await page.setViewportSize({ width: 0, height: 0 });
			try { await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }); await session.send("Browser.setWindowBounds", { windowId, bounds: bounds.windowState === "normal" ? bounds : { windowState: bounds.windowState } }); } finally { await session.detach(); }
		}
	}
}
