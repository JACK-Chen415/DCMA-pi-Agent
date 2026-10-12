async (page) => {
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const baseline = await (await page.request.get("http://127.0.0.1:3000/api/database/dashboard?table=real_data_01&limit=100")).json();
	let mode = "success", requests = 0, release = null, lateRelease = null;
	const makeData = (table, limit) => {
		const data = structuredClone(baseline);
		data.table = table; data.limit = limit;
		const motor = table === "real_data" ? 1 : Number(table.slice(-2));
		data.latest.raw.device_name = `验收电机${motor}`;
		data.latest.values.speed_actual = 0;
		data.latest.values.current_actual = null;
		data.latest.raw.air_intake_temp = -200;
		data.latest.values.air_intake_temp = -200;
		data.latest.raw.feedback_power = 0.123456789;
		data.warnings = ["real_data_04：其他电机的验收警告"];
		data.samples = data.samples.slice(0, 4);
		data.samples.forEach((sample, index) => { sample.values.speed_actual = index === 1 ? null : index - 2; });
		if (mode === "empty") { data.latest = null; data.records = []; data.samples = []; data.returned = 0; data.sources.forEach((source) => { source.latest = null; source.message = "暂无采样记录"; }); }
		if (mode === "truncated") { data.truncated = true; data.warnings = ["响应大小达到上限，较早采样已截断；最新读数保持不变。"]; }
		return data;
	};
	await page.route("**/api/database/dashboard?**", async (route) => {
		requests++;
		const url = new URL(route.request().url());
		const table = url.searchParams.get("table"), limit = Number(url.searchParams.get("limit"));
		const body = makeData(table, limit);
		if (mode === "slow") await new Promise((resolve) => { release = resolve; });
		if (mode === "race" && table === "real_data_02") { body.latest.raw.device_name = "旧响应电机2"; await new Promise((resolve) => { lateRelease = resolve; }); }
		try {
			await route.fulfill({ status: mode === "fail" ? 503 : 200, contentType: "application/json", body: JSON.stringify(mode === "fail" ? { error: "验收模拟查询失败" } : body) });
		} catch { /* 切换已取消的请求无需回写。 */ }
	});
	try {
		await page.goto("http://127.0.0.1:3000");
		await page.getByRole("heading", { name: "验收电机1", exact: true }).waitFor();
		check(await page.getByText("real_data_04：其他电机的验收警告", { exact: true }).count() === 0, "显示了未选电机的警告");
		check(await page.locator(".gauge-value").nth(0).innerText() === "0", "0被当作缺失");
		check(await page.locator(".gauge-value").nth(1).innerText() === "—", "缺失电流未显示破折号");
		const nav = page.getByRole("navigation", { name: "监控页面" });
		await nav.getByRole("link", { name: "设备概览", exact: true }).click();
		check((await page.getByRole("region", { name: "完整参数", exact: true }).innerText()).includes("-200"), "-200未保留");
		check((await page.getByRole("region", { name: "完整参数", exact: true }).innerText()).includes("0.123456789"), "原始数值被舍入");
		await nav.getByRole("link", { name: "运行指标", exact: true }).click();
		check((await page.getByRole("region", { name: "温度参数" }).innerText()).includes("-200"), "分组指标丢失特殊值");
		check((await page.getByRole("region", { name: "电气参数" }).innerText()).includes("—"), "分组指标缺失值未标明");
		await nav.getByRole("link", { name: "实时数据", exact: true }).click();
		const path = await page.locator(".chart-surface svg path").nth(1).getAttribute("d");
		check((path.match(/M/g) || []).length === 2, "缺失值跨点连线");
		mode = "fail";
		await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.locator(".notice.error").waitFor();
		check((await page.locator(".notice.error").innerText()).includes("保留上次成功结果"), "同选择刷新失败没有保留提示");
		check(await page.locator(".gauge-value").nth(0).innerText() === "0", "同选择失败丢失上次结果");
		await page.getByRole("combobox", { name: "查看设备" }).selectOption("2");
		await page.getByText(/当前选择查询失败/).waitFor();
		check(await page.locator(".gauge-value").nth(0).innerText() === "—", "切换失败残留旧设备值");
		mode = "empty";
		await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.getByText("暂无采样记录", { exact: true }).first().waitFor();
		check(await page.locator(".chart-empty").isVisible(), "空表缺少空曲线提示");
		await nav.getByRole("link", { name: "故障与报警", exact: true }).click();
		await page.getByText("当前采样窗口暂无代码记录", { exact: true }).waitFor();
		check(await page.locator(".code-table tbody tr").count() === 0, "空表仍有旧代码记录");
		await nav.getByRole("link", { name: "采样明细", exact: true }).click();
		check(await page.locator("table tbody tr").count() === 0, "空表仍有旧采样记录");
		await nav.getByRole("link", { name: "实时数据", exact: true }).click();
		mode = "truncated";
		await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.getByText(/响应大小达到上限/).waitFor();
		check((await page.locator(".window-count").innerText()).includes("响应已截断"), "截断标识缺失");
		mode = "slow"; requests = 0;
		await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.getByRole("button", { name: "正在查询…", exact: true }).waitFor();
		await page.waitForTimeout(6000);
		check(requests === 1, "慢请求期间发生重叠请求");
		check(await page.getByRole("button", { name: "正在查询…", exact: true }).isDisabled(), "查询期间手动刷新未禁用");
		mode = "success"; release();
		await page.getByRole("button", { name: "刷新数据", exact: true }).waitFor();
		mode = "race";
		await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.getByRole("button", { name: "正在查询…", exact: true }).waitFor();
		await page.getByRole("combobox", { name: "查看设备" }).selectOption("3");
		await page.getByRole("heading", { name: "验收电机3", exact: true }).waitFor();
		lateRelease();
		await page.waitForTimeout(300);
		check(await page.getByRole("heading", { name: "旧响应电机2", exact: true }).count() === 0, "旧响应覆盖新选择");
		await page.getByRole("combobox", { name: "采样条数" }).selectOption("50");
		await page.getByRole("combobox", { name: "采样条数" }).selectOption("200");
		await page.getByRole("combobox", { name: "查看设备" }).selectOption("4");
		await page.getByRole("heading", { name: "验收电机4", exact: true }).waitFor();
		await page.getByText("real_data_04：其他电机的验收警告", { exact: true }).waitFor();
		await page.screenshot({ path: "output/playwright/edge-cases.png" });
		console.log("PASS: 0/缺失/-200/原值精度、缺失断线、同选择失败保留、切换失败清空、空表、截断、慢请求不重叠、取消旧请求和竞态保护。");
	} finally {
		if (release) release(); if (lateRelease) lateRelease();
		await page.unroute("**/api/database/dashboard?**");
		await page.goto("http://127.0.0.1:3000");
	}
}
