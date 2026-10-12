async (page) => {
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const numeric = "dc_voltage speed_setpoint speed_actual current_actual torque_setpoint torque_actual air_intake_temp motor_temp inverter_temp actual_power field_current torque_current inverter_radiator_temp inverter_load_rate motor_load_rate pulse_frequency motor_power feedback_power".split(" ");
	const viewport = page.viewportSize();
	let mode = "success";
	const errors = [];
	const captureError = (error) => errors.push(error.message);
	page.on("pageerror", captureError);
	const fixture = (table, limit) => {
		const motor = table === "real_data" ? 1 : Number(table.slice(-2));
		const records = Array.from({ length: mode === "empty" ? 0 : 5 }, (_, index) => {
			const values = Object.fromEntries(numeric.map((field) => [field, mode === "missing" ? null : index + 1]));
			if (mode !== "missing") { values.speed_setpoint = 100; values.speed_actual = [0, null, -20, 15, 0.123456789][index]; }
			const acquiredAt = new Date(1791777600000 + index * 1000).toISOString();
			return {
				id: String(index), acquiredAt, ingestedAt: acquiredAt, values,
				raw: { ...values, id: String(index), timestamp: String(Date.parse(acquiredAt)), device_name: `验收电机${motor}`, inverter_name: `验收变频器${motor}`, date: "2026-10-12", time: "12:00:00", create_time: "2026-10-12 12:00:00", status: 0, system_run_time: 0, fault_code: [0, "F1", "F1", 0, 0][index], alarm_code: [0, 0, "A1", "A1", 0][index], control_word: 0, status_word: 0 },
			};
		});
		return { schema: "dcma", table, limit, queriedAt: new Date().toISOString(), latest: records.at(-1) ?? null, sources: [{ table, deviceIndex: motor, kind: "simulation", available: true, latest: records.at(-1) ?? null, message: "验收数据" }], records: [...records].reverse(), samples: records.map(({ id, acquiredAt, values }) => ({ id, acquiredAt, values })), returned: records.length, hasMore: false, truncated: false, warnings: [] };
	};
	const routePattern = "**/api/database/dashboard?**";
	await page.route(routePattern, async (route) => {
		const url = new URL(route.request().url());
		await route.fulfill({ status: mode === "fail" ? 503 : 200, contentType: "application/json", body: JSON.stringify(mode === "fail" ? { error: "验收查询失败" } : fixture(url.searchParams.get("table"), Number(url.searchParams.get("limit")))) });
	});
	try {
		await page.goto("http://127.0.0.1:3000/#realtime");
		await page.getByRole("heading", { name: "验收电机1", exact: true }).waitFor();
		const events = page.getByRole("region", { name: "近期事件列表" });
		check(await events.locator("tbody tr").count() === 2, "连续代码应合并为两个故障/报警事件");
		check((await events.innerText()).includes("F1") && (await events.innerText()).includes("A1"), "事件列表缺少原始代码");
		check(await page.locator(".running-card").count() === 4, "不应额外添加环境温度或运行时间");
		const downloadButton = page.getByRole("button", { name: "下载图表", exact: true });
		const dataButton = page.getByRole("button", { name: "数据视图", exact: true });
		await dataButton.click();
		const data = page.getByRole("region", { name: "曲线数据视图" });
		check(await data.locator("tbody tr").count() === 5, "数据表与曲线采样数量不一致");
		check(await data.locator("thead th").count() === 3, "数据视图应仅包含时间和当前两项指标");
		const actual = await data.locator("tbody tr td:last-child").allTextContents();
		check(JSON.stringify(actual) === JSON.stringify(["0", "—", "-20", "15", "0.123456789"]), "数据视图未保留0、缺失、负数或精度");
		check((await data.locator("tbody tr").first().innerText()).includes("12:00:00.000"), "数据视图应显示北京时间到毫秒");
		for (const width of [1920, 1366, 768, 375]) {
			await page.setViewportSize({ width, height: 1000 });
			check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}实时页面横向溢出`);
			await page.screenshot({ path: `output/playwright/trend-tools-${width}.png`, fullPage: true });
		}
		await page.setViewportSize({ width: 1366, height: 900 });
		const downloaded = page.waitForEvent("download");
		await downloadButton.click();
		const png = await downloaded;
		check(png.suggestedFilename().endsWith(".png"), "导出格式不是PNG");
		await png.saveAs("output/playwright/trend-export.png");
		check(await page.getByRole("alert").count() === 0, "图表下载报错");
		await page.getByRole("button", { name: "放大查看", exact: true }).click();
		await page.getByRole("button", { name: "退出全屏", exact: true }).waitFor();
		check(await page.evaluate(() => document.fullscreenElement?.classList.contains("trend-widget")), "没有进入原生全屏");
		check(await data.locator("tbody tr").count() === 5, "全屏下数据视图丢失");
		await page.screenshot({ path: "output/playwright/trend-fullscreen.png" });
		await page.getByRole("button", { name: "退出全屏", exact: true }).click();
		await page.getByRole("button", { name: "放大查看", exact: true }).waitFor();
		check(await page.evaluate(() => document.fullscreenElement === null), "退出全屏失败");
		await page.getByRole("combobox", { name: "查看指标", exact: true }).selectOption("torque");
		await dataButton.click();
		check((await data.locator("thead").innerText()).includes("设定转矩（N·m）"), "切换指标后数据视图未对应新曲线");
		await page.getByRole("combobox", { name: "查看设备", exact: true }).selectOption("2");
		await page.getByRole("heading", { name: "验收电机2", exact: true }).waitFor();
		check((await page.locator(".device-detail").innerText()).includes("验收电机2"), "设备切换失败");
		mode = "fail";
		await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.getByText(/验收查询失败/).waitFor();
		check(await events.locator("tbody tr").count() === 2, "刷新失败时近期事件应保留上次结果");
		mode = "empty";
		await page.getByRole("combobox", { name: "查看设备", exact: true }).selectOption("3");
		await page.getByText("当前采样窗口暂无记录", { exact: true }).waitFor();
		check(await events.locator("tbody tr").count() === 0, "切换设备后混入旧事件");
		check(await downloadButton.isDisabled(), "空曲线不应下载");
		mode = "missing";
		await page.getByRole("combobox", { name: "查看设备", exact: true }).selectOption("4");
		await page.getByRole("heading", { name: "验收电机4", exact: true }).waitFor();
		check(await downloadButton.isDisabled(), "全缺失值不应生成假曲线");
		await dataButton.click();
		check(await data.locator("tbody tr").count() === 5, "缺失指标仍应显示对应时间记录");
		check(await page.locator(".chart-surface svg").count() === 0, "全缺失值不应画曲线");
		check(errors.length === 0, `页面运行错误：${errors.join("；")}`);
		console.log("PASS: 实时近期事件合并、PNG实际下载、原生全屏与退出、当前曲线数据视图/精度、四档布局、指标/设备切换及失败/空数据/缺失值。");
	} finally {
		if (await page.evaluate(() => !!document.fullscreenElement)) await page.evaluate(() => document.exitFullscreen());
		await page.unroute(routePattern);
		page.off("pageerror", captureError);
		if (viewport) await page.setViewportSize(viewport);
		await page.goto("http://127.0.0.1:3000/#realtime");
	}
}
