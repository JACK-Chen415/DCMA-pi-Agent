async (page) => {
	const check = (value, message) => { if (!value) throw new Error(message); };
	const baseline = await (await page.request.get("http://127.0.0.1:3000/api/database/dashboard?table=real_data_01&limit=100")).json();
	const session = await page.context().newCDPSession(page);
	const { windowId, bounds } = await session.send("Browser.getWindowForTarget");
	const requests = [], realtimeRequests = [];
	let mode = "success", release = null;
	await page.route("**/api/database/dashboard?**", async (route) => {
		realtimeRequests.push(Date.now());
		const url = new URL(route.request().url()), data = structuredClone(baseline);
		data.table = url.searchParams.get("table"); data.limit = Number(url.searchParams.get("limit"));
		await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
	});
	await page.route("**/api/database/sample-history?**", async (route) => {
		const url = new URL(route.request().url()), query = Object.fromEntries(url.searchParams);
		requests.push(query);
		const rows = Array.from({ length: 121 }, (_, index) => {
			const record = structuredClone(baseline.latest);
			record.id = String(121 - index); record.raw.id = record.id;
			record.acquiredAt = new Date(Date.parse("2026-10-10T04:02:00.000Z") - index * 1000).toISOString();
			record.raw.timestamp = String(Date.parse(record.acquiredAt));
			record.raw.speed_actual = -index; record.values.speed_actual = -index;
			return record;
		}).filter((row) => row.acquiredAt >= query.from && row.acquiredAt <= query.to);
		const data = { ...structuredClone(baseline), ...query, limit: Number(query.limit), page: Number(query.page), total: rows.length, warnings: [], truncated: false };
		data.records = rows.slice((data.page - 1) * data.limit, data.page * data.limit);
		data.returned = data.records.length; data.latest = data.records[0] ?? null;
		data.samples = data.records.map(({ id, acquiredAt, values }) => ({ id, acquiredAt, values })).reverse();
		data.hasMore = data.page * data.limit < data.total;
		data.sources = [{ ...baseline.sources[0], table: data.table, latest: data.latest }];
		const fail = mode === "fail";
		if (mode === "slow") await new Promise((resolve) => { release = resolve; });
		try { await route.fulfill({ status: fail ? 503 : 200, contentType: "application/json", body: JSON.stringify(fail ? { error: "历史采样模拟失败" } : data) }); } catch { /* 旧请求已取消。 */ }
	});
	try {
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.goto("http://127.0.0.1:3000/#query");
		await page.getByRole("heading", { name: "数据查询", level: 1, exact: true }).waitFor();
		check(await page.getByRole("navigation").getByRole("link", { name: "数据查询", exact: true }).getAttribute("aria-current") === "page", "查询菜单未选中");
		check(await page.getByRole("button", { name: "刷新查询", exact: true }).isDisabled(), "未选择时间仍可刷新");
		check(requests.length === 0, "进入查询页自动查全部历史");
		check(await page.getByRole("button", { name: "开始时间（北京时间）设为现在", exact: true }).count() === 0, "开始时间仍显示现在按钮");
		for (const label of ["结束时间（北京时间）"]) {
			const before = Date.now();
			await page.getByRole("button", { name: `${label}设为现在`, exact: true }).click();
			const date = await page.getByLabel(`${label}日期`, { exact: true }).inputValue();
			const time = await page.getByLabel(`${label}时间（24小时制）`, { exact: true }).inputValue();
			const chosen = Date.parse(`${date}T${time}+08:00`);
			check(chosen >= before - 1000 && chosen <= Date.now(), `${label}现在未填入当前北京时间`);
		}
		check(requests.length === 0, "现在按钮提前提交了查询");
		const timeInput = (label) => ({ inputValue: async () => {
			const date = await page.getByLabel(`${label}日期`, { exact: true }).inputValue();
			return date ? `${date}T${await page.getByLabel(`${label}时间（24小时制）`, { exact: true }).inputValue()}` : "";
		}, fill: async (value) => {
			const [date, time] = value.split("T");
			await page.getByLabel(`${label}日期`, { exact: true }).fill(date);
			await page.getByLabel(`${label}时间（24小时制）`, { exact: true }).fill(time);
		} });
		const from = timeInput("开始时间（北京时间）"), to = timeInput("结束时间（北京时间）");
		const query = () => page.getByRole("button", { name: "查询数据", exact: true }).click();
		const ready = () => page.waitForFunction(() => !document.querySelector(".header-actions button").disabled);
		await from.fill("2026-10-10T12:00"); await to.fill("2026-10-10T12:02");
		const clock = page.getByLabel("开始时间（北京时间）时间（24小时制）", { exact: true });
		check(await clock.getAttribute("type") === "text", "时间输入仍依赖系统12小时制");
		for (const time of ["00:00:00", "18:30:00", "23:59:59"]) {
			await clock.fill(time);
			check(await clock.evaluate((input) => input.checkValidity()), `${time}有效24小时时间被拒绝`);
		}
		for (const time of ["24:00:00", "18:60:00", "06:30 PM"]) {
			await clock.fill(time);
			check(!await clock.evaluate((input) => input.checkValidity()), `${time}无效时间被接受`);
		}
		await clock.fill("12:00");
		await page.getByRole("combobox", { name: "每页条数", exact: true }).selectOption("50");
		check(requests.length === 0, "编辑时间或条数时提前请求");
		await query(); await ready();
		check(requests.at(-1).from === "2026-10-10T04:00:00.000Z" && requests.at(-1).to === "2026-10-10T04:02:00.000Z", "北京时间转换错误");
		check(await page.locator("tbody tr").count() === 50, "第一页不是50条");
		check(await page.locator(".event-pagination").innerText() === "上一页\n第 1 / 3 页 · 共 121 条\n下一页", "分页总数错误");
		check(await page.locator(".gauge-card").count() === 0 && await page.getByRole("region", { name: "运行信息", exact: true }).count() === 0, "历史页混入实时仪表或运行卡");
		const chart = page.getByRole("group", { name: /设定转速与实际转速趋势/ });
		check((await chart.locator("title").textContent()).includes("50条采样"), "趋势不是当前页");
		await chart.focus(); await page.keyboard.press("End");
		check((await page.locator(".chart-tooltip").innerText()).includes(`记录 ${await page.locator("tbody tr").first().locator("td").first().textContent()}`), "曲线与明细不是同一页");
		await page.keyboard.press("Escape");
		const counts = [requests.length, realtimeRequests.length];
		await page.waitForTimeout(6300);
		check(requests.length === counts[0] && realtimeRequests.length === counts[1], "历史页仍自动轮询");
		await page.getByRole("button", { name: "下一页", exact: true }).click(); await ready();
		check(requests.at(-1).page === "2" && await page.locator("tbody tr").first().locator("td").first().textContent() === "71", "第二页不稳定");
		await page.getByRole("button", { name: "下一页", exact: true }).click(); await ready();
		check(await page.locator("tbody tr").count() === 21 && await page.getByRole("button", { name: "下一页", exact: true }).isDisabled(), "最后一页错误");
		await page.getByRole("combobox", { name: "每页条数", exact: true }).selectOption("200"); await ready();
		check(requests.at(-1).page === "1" && await page.locator("tbody tr").count() === 121, "更改条数未返回第一页");
		for (const width of [375, 768, 1366, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}查询页横向溢出`);
			if (width === 375 || width === 1366) await page.screenshot({ path: `output/playwright/sample-query-${width}.png`, fullPage: true });
		}
		await from.fill("2026-10-11T12:00");
		const before = requests.length; await query();
		await page.getByText("开始时间不能晚于结束时间。", { exact: true }).waitFor();
		check(requests.length === before, "逆序时间仍查询");
		await from.fill("2026-10-10T12:00");
		mode = "fail"; await query();
		await page.getByText(/刷新失败，以下保留上次成功结果/).waitFor();
		check(await page.locator("tbody tr").count() === 121, "同条件失败丢失结果");
		await from.fill("2026-10-09T12:00"); await to.fill("2026-10-09T12:02"); await query();
		await page.getByText(/当前选择查询失败/).waitFor();
		check(await page.locator("tbody tr").count() === 0, "换条件失败残留旧数据");
		mode = "success"; await query(); await ready();
		await page.getByText("所选时间段暂无采样记录。", { exact: true }).waitFor();
		mode = "slow"; await from.fill("2026-10-10T12:00"); await to.fill("2026-10-10T12:02"); await query();
		await page.getByRole("button", { name: "查询采样中…", exact: true }).waitFor();
		await page.getByRole("combobox", { name: "查看设备", exact: true }).selectOption("2");
		mode = "success"; release?.();
		check(await from.inputValue() === "" && await page.locator("tbody tr").count() === 0, "切设备未重置查询");
		await page.waitForTimeout(150);
		check(await page.locator("tbody tr").count() === 0, "已取消旧响应回写");
		await page.getByRole("combobox", { name: "查看设备", exact: true }).selectOption("1");
		await from.fill("2026-10-10T12:00"); await to.fill("2026-10-10T12:02"); await query(); await ready();
		await page.getByRole("combobox", { name: "数据来源", exact: true }).selectOption("history");
		check(await from.inputValue() === "" && await page.locator("tbody tr").count() === 0, "切来源未重置查询");
		await page.getByRole("button", { name: "返回实时", exact: true }).click();
		await page.getByRole("heading", { name: "实时数据", exact: true, level: 1 }).waitFor();
		check(await page.locator(".gauge-card").count() === 6, "返回实时缺少仪表");
		const liveCount = realtimeRequests.length;
		await page.waitForTimeout(3500);
		check(realtimeRequests.length > liveCount, "返回实时未恢复3秒轮询");
		console.log("PASS: 独立数据查询菜单、北京时间/时间边界、历史趋势与明细同步、稳定分页、无自动刷新、无效范围/空结果、失败保留与换条件清空、切设备/来源取消、四档布局、返回实时恢复轮询。");
	} finally {
		release?.();
		await page.unroute("**/api/database/dashboard?**"); await page.unroute("**/api/database/sample-history?**");
		await page.goto("http://127.0.0.1:3000/#query");
		await session.send("Emulation.setDeviceMetricsOverride", { width: 0, height: 0, deviceScaleFactor: 0, mobile: false });
		await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal", left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } });
		if (bounds.windowState !== "normal") await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: bounds.windowState } });
		await session.detach();
	}
}
