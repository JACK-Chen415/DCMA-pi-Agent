async (page) => {
	const check = (value, message) => { if (!value) throw new Error(message); };
	const baseline = await (await page.request.get("http://127.0.0.1:3000/api/database/dashboard?table=real_data_01&limit=100")).json();
	const session = await page.context().newCDPSession(page);
	const { windowId, bounds } = await session.send("Browser.getWindowForTarget");
	const fixed = [["speed_actual", "实际转速（rpm）", -1500, 1500], ["current_actual", "实际电流（A）", 0, 3.3], ["dc_voltage", "直流母线电压（V）", 0, 1200], ["inverter_temp", "变频器温度（°C）", 0, 150], ["motor_temp", "电机温度（°C）", 0, 150]];
	let scenario = "middle";
	const value = (min, max) => scenario === "middle" ? (min + max) / 2 : scenario === "below" ? min - 10 : scenario === "above" ? max + 10 : null;
	const text = (value) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
	await page.route("**/api/database/dashboard?**", async (route) => {
		const url = new URL(route.request().url()), data = structuredClone(baseline);
		data.table = url.searchParams.get("table"); data.limit = Number(url.searchParams.get("limit"));
		data.latest.raw.device_name = `量程验收 · ${scenario}`;
		for (const [field, , min, max] of fixed) data.latest.values[field] = value(min, max);
		data.latest.values.torque_actual = -10;
		for (const [index, sample] of data.samples.entries()) {
			for (const [field] of fixed) sample.values[field] = scenario === "middle" ? index * 9999 : -index * 9999;
			sample.values.torque_actual = index % 2 ? 20 : -10;
		}
		await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
	});
	try {
		await page.setViewportSize({ width: 1366, height: 900 });
		for (const mode of ["middle", "below", "above", "missing"]) {
			scenario = mode;
			await page.goto("http://127.0.0.1:3000/#realtime"); await page.reload();
			await page.getByRole("heading", { name: `量程验收 · ${scenario}`, exact: true }).waitFor();
			for (const [, label, min, max] of fixed) {
				const gauge = page.locator(".gauge-card").filter({ has: page.getByRole("heading", { name: label, exact: true }) });
				check(JSON.stringify(await gauge.locator("svg text").allTextContents()) === JSON.stringify([text((min + max) / 2), text(min), text(max)]), `${mode}/${label}量程随采样变化`);
				check((await gauge.locator("svg title").textContent()).includes("量程"), `${label}无障碍描述缺少量程`);
				check(await gauge.locator(".gauge-value").innerText() === (mode === "missing" ? "—" : text(value(min, max))), `${mode}/${label}原始读数被裁剪`);
				const fill = gauge.locator('path[stroke="#2563eb"]');
				if (mode === "missing") check(await fill.count() === 0 && await gauge.locator('line[stroke="#1d4ed8"]').count() === 0, `${label}缺失时仍显示指针`);
				else check(await fill.getAttribute("stroke-dasharray") === `${mode === "middle" ? .5 : mode === "below" ? 0 : 1} 1`, `${mode}/${label}指针位置错误`);
			}
			const torque = page.locator(".gauge-card").filter({ has: page.getByRole("heading", { name: "实际转矩（N·m）", exact: true }) });
			check(JSON.stringify(await torque.locator("svg text").allTextContents()) === JSON.stringify(["5", "-10", "20"]), "实际转矩未保留原有采样范围");
			check((await torque.locator("svg title").textContent()).includes("采样范围"), "实际转矩无障碍描述缺少采样范围");
			check(await page.locator(".gauge-range").count() === 0, "仪表底部范围文字未移除");
			check(JSON.stringify(await page.locator(".gauge-card h3").allTextContents()) === JSON.stringify(["实际转速（rpm）", "实际电流（A）", "实际转矩（N·m）", "直流母线电压（V）", "变频器温度（°C）", "电机温度（°C）"]), "仪表单位未统一放在标题括号中");
			check(await page.locator(".gauge-card p, .gauge-unit").count() === 0, "读数下方仍显示单位或范围文字");
			if (mode === "middle") {
				for (const limit of ["50", "200", "100"]) {
					await page.getByRole("combobox", { name: "采样条数", exact: true }).selectOption(limit);
					await page.getByRole("button", { name: "刷新数据", exact: true }).waitFor();
					check(await page.locator(".gauge-card").first().locator("svg text").nth(1).textContent() === "-1,500", "切换采样条数改变量程");
				}
				for (const width of [375, 768, 1366, 1920]) {
					await page.setViewportSize({ width, height: 900 });
					check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}仪表横向溢出`);
				}
				await page.setViewportSize({ width: 1366, height: 900 });
				await page.locator(".gauge-grid").screenshot({ path: "output/playwright/gauges-fixed.png" });
			}
		}
		console.log("PASS: 五项固定量程、中点指针、超量程边界与真实读数、缺失无指针、转矩沿用采样范围、采样条数及四档布局；数据库未写入。");
	} finally {
		try { await page.unroute("**/api/database/dashboard?**"); await page.goto("http://127.0.0.1:3000/#realtime"); await page.reload(); await page.locator(".sidebar-footer").filter({ hasText: "数据库查询成功" }).waitFor(); }
		finally { await page.setViewportSize({ width: 0, height: 0 }); try { await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }); await session.send("Browser.setWindowBounds", { windowId, bounds: bounds.windowState === "normal" ? bounds : { windowState: bounds.windowState } }); } finally { await session.detach(); } }
	}
}
