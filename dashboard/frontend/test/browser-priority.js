async (page) => {
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const baseline = await (await page.request.get("http://127.0.0.1:3000/api/database/dashboard?table=real_data_01&limit=100")).json();
	check(!!baseline.latest, "需要可读取的展板基准数据");
	const event = { id: "fault/1", field: "fault_code", code: "F01030", startedAt: "2026-01-14T10:20:37.005Z", endedAt: null, lastSeenAt: "2026-01-14T10:27:24.814Z", samples: 2, ending: null, startUncertain: true, hasMissingSamples: true };
	let mode = "slow", release;
	const sampleRequests = [];
	await page.route("**/api/database/dashboard?**", async (route) => {
		const url = new URL(route.request().url()), data = structuredClone(baseline);
		data.table = url.searchParams.get("table"); data.limit = Number(url.searchParams.get("limit"));
		const motor = data.table === "real_data" ? 1 : Number(data.table.slice(-2));
		data.records = data.records.slice(0, 5);
		data.records.forEach((record, i) => { record.raw.device_name = `G120电机${motor}`; record.raw.inverter_name = `G120电机${motor}`; record.raw.fault_code = i < 2 ? "F01030" : 0; record.raw.alarm_code = 0; });
		data.latest = data.records[0]; data.returned = data.records.length;
		await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
	});
	await page.route("**/api/database/code-history?**", async (route) => {
		const url = new URL(route.request().url());
		if (mode === "slow") await new Promise((resolve) => { release = resolve; });
		const events = mode === "empty" ? [] : [event];
		const result = { table: url.searchParams.get("table"), page: Number(url.searchParams.get("page")), pageSize: 50, queriedAt: new Date().toISOString(), total: events.length, faults: events.length, alarms: 0, open: events.length, invalidTimes: 0, events, codes: events.length ? [{ field: event.field, code: event.code, count: 1, durationMs: Date.parse(event.lastSeenAt) - Date.parse(event.startedAt) }] : [] };
		try { await route.fulfill({ status: mode === "fail" ? 503 : 200, contentType: "application/json", body: JSON.stringify(mode === "fail" ? { error: "测试历史读取失败" } : result) }); } catch { /* 允许取消旧查询。 */ }
	});
	await page.route("**/api/database/sample-history?**", async (route) => {
		const url = new URL(route.request().url()), data = structuredClone(baseline);
		sampleRequests.push(Object.fromEntries(url.searchParams));
		data.table = url.searchParams.get("table"); data.limit = Number(url.searchParams.get("limit")); data.page = Number(url.searchParams.get("page"));
		data.from = url.searchParams.get("from"); data.to = url.searchParams.get("to"); data.total = 101;
		data.records = data.records.slice(0, 3); data.returned = 3;
		data.records.forEach((record, i) => { record.acquiredAt = new Date(Date.parse(data.to) - i * 1000).toISOString(); });
		data.latest = data.records[0]; data.samples = [...data.records].reverse().map(({ id, acquiredAt, values }) => ({ id, acquiredAt, values }));
		await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
	});
	const navigate = async (view) => {
		if (await page.locator(".mobile-nav").isVisible()) await page.getByLabel("切换监控页面").selectOption(view);
		else await page.locator(`.sidebar-nav a[href="#${view}"]`).click();
	};
	try {
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.goto("http://127.0.0.1:3000/#codes");
		await page.reload();
		await page.waitForFunction(() => document.querySelector(".code-summary-card strong")?.textContent === "—");
		check((await page.locator(".code-summary").innerText()).includes("查询中"), "加载汇总仍伪装成零次");
		mode = "fail"; release();
		await page.getByText("测试历史读取失败", { exact: true }).waitFor();
		check((await page.locator(".code-summary-card strong").allTextContents()).every((text) => text === "—"), "首次失败仍显示零次");
		check(!(await page.locator(".code-event-table").locator("..").innerText()).includes("所选时间段暂无异常记录"), "失败误报无异常");
		mode = "empty"; await page.getByRole("button", { name: "全部时间", exact: true }).click();
		await page.waitForFunction(() => document.querySelector(".code-summary-card strong")?.textContent === "0");
		mode = "success"; await page.getByRole("button", { name: "全部时间", exact: true }).click();
		await page.locator(".code-event-table tbody tr").waitFor();
		await page.getByLabel("数据来源", { exact: true }).selectOption("history");
		await page.getByRole("button", { name: "查看前后趋势", exact: true }).click();
		await page.waitForURL("**/#query");
		await page.getByText("第 1 / 2 页 · 共 101 条", { exact: true }).waitFor();
		const request = sampleRequests.at(-1);
		check(request.table === "real_data" && request.from === "2026-01-14T10:15:37.000Z" && request.to === "2026-01-14T10:32:25.000Z", "事件来源、未结束区间或缓冲时间错误");
		check(await page.getByLabel("开始时间（北京时间）时间（24小时制）", { exact: true }).inputValue() === "18:15:37", "事件北京时间填入错误");
		await page.getByRole("button", { name: "下一页", exact: true }).click();
		await page.getByText("第 2 / 2 页 · 共 101 条", { exact: true }).waitFor();
		await page.getByLabel("查看设备", { exact: true }).selectOption("2");
		check(await page.getByLabel("开始时间（北京时间）日期", { exact: true }).inputValue() === "", "切设备未清空事件时间");
		check(await page.getByRole("region", { name: "采样趋势", exact: true }).count() === 0, "切设备残留旧历史结果");
		const queryTop = await page.getByRole("region", { name: "采样时间查询", exact: true }).evaluate((node) => node.getBoundingClientRect().top);
		check(queryTop < await page.locator(".device-detail").evaluate((node) => node.getBoundingClientRect().top), "查询表单未前移");
		check(await page.locator(".device-detail .time-grid").count() === 0, "未查询时仍显示空时间块");
		await page.getByRole("button", { name: "返回实时", exact: true }).click();
		await page.locator(".recent-event-table tbody tr").waitFor();
		await page.getByRole("button", { name: "查看前后趋势", exact: true }).first().click();
		await page.getByText("第 1 / 2 页 · 共 101 条", { exact: true }).waitFor();
		check(sampleRequests.at(-1).table === "real_data_02" && sampleRequests.at(-1).page === "1", "近期事件跳转混设备或未重置页码");
		await page.getByRole("button", { name: "返回实时", exact: true }).click();
		for (const width of [375, 768, 944, 1366, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			for (const view of ["overview", "realtime", "metrics", "codes", "records", "query", "settings"]) {
				await navigate(view);
				check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view}/${width}页面横向溢出`);
				if (view === "overview" || view === "realtime") {
					const columns = await page.locator(".running-grid").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
					check(columns === (width <= 1100 ? 2 : 4), `${width}仍有3+1卡片`);
				}
				if (view === "realtime") {
					await page.waitForFunction(() => {
						const svg = document.querySelector(".chart-surface svg");
						return svg && Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 2;
					});
					const chart = await page.locator(".chart-surface svg").evaluate((svg) => ({ texts: svg.querySelectorAll("text").length, font: getComputedStyle(svg.querySelector("text")).fontSize, top: svg.getBoundingClientRect().top }));
					check(chart.font === "12px" && chart.texts === (await page.locator(".chart-surface svg").evaluate((svg) => svg.getBoundingClientRect().width) < 480 ? 5 : 8), "趋势刻度未按尺寸保持可读字号");
					if (width === 375) check(chart.top < 812, `手机首屏未出现趋势：${chart.top}`);
					await page.locator(".chart-surface svg").focus(); await page.keyboard.press("Home");
					check(await page.locator(".chart-tooltip").isVisible(), "图表键盘查看失效");
					await page.keyboard.press("Escape");
					await page.screenshot({ path: `output/playwright/priority-realtime-${width}.png`, fullPage: true });
				}
				if (view === "records") {
					await page.getByLabel("查看采样字段").selectOption("电气参数");
					check(await page.locator(".sample-table th").count() === 7, "电气字段分组缺项或遗漏编号时间");
					check(await page.locator(".sample-table td.sample-number").first().evaluate((node) => getComputedStyle(node).textAlign) === "center", "采样数值未居中");
					check(await page.locator(".sample-table tbody tr").first().locator("td").nth(2).innerText() === baseline.records[0].values.dc_voltage.toLocaleString("zh-CN", { maximumFractionDigits: 2, useGrouping: false }), "采样读数未按两位小数显示");
					if (width === 1366) {
						await page.locator(".sample-table").evaluate((node) => { node.scrollLeft = 400; });
						check(await page.locator(".sample-table .sticky-id").first().evaluate((node) => Math.abs(node.getBoundingClientRect().left - node.closest(".table-scroll").getBoundingClientRect().left) < 2), "编号列未固定");
						await page.screenshot({ path: "output/playwright/priority-records-1366.png", fullPage: true });
					}
					await page.getByLabel("查看采样字段").selectOption("全部字段");
					check(await page.locator(".sample-table th").count() === 29, "全部字段未保留29项");
				}
				if (view === "query" && [375, 1366].includes(width)) {
					await page.waitForFunction(() => getComputedStyle(document.querySelector('section[aria-label="采样时间查询"]')).opacity === "1");
					await page.screenshot({ path: `output/playwright/priority-query-${width}.png`, fullPage: true });
				}
			}
		}
		console.log("priority checks passed: loading/failure/empty, historical/recent event navigation, source reset, 35 layouts, two-decimal samples, sticky columns, keyboard chart");
	} finally {
		if (release) release();
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.goto("http://127.0.0.1:3000/#realtime");
		await page.reload();
	}
}
