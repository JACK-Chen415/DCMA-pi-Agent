async (page) => {
	const windowSession = await page.context().newCDPSession(page);
	const { windowId, bounds } = await windowSession.send("Browser.getWindowForTarget");
	try {
		const check = (condition, message) => { if (!condition) throw new Error(message); };
		await page.goto("http://127.0.0.1:3000");
		await page.locator(".sidebar-footer").filter({ hasText: "数据库查询成功" }).waitFor();
		const nav = page.getByRole("navigation", { name: "监控页面" });
		const pages = ["设备概览", "实时数据", "运行指标", "故障与报警", "采样明细"];
		check(await nav.getByRole("link").count() === 7, "侧边栏菜单不是七项");
		for (const width of [1366, 1920]) {
			await page.setViewportSize({ width, height: width === 1366 ? 900 : 1080 });
			check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}页面横向溢出`);
			check(await page.locator(".gauge-card").count() === 6, "六个仪表缺失");
			check(await page.getByRole("region", { name: "四台电机概览" }).count() === 0, "仍展示其他电机概览");
			await page.screenshot({ path: `output/playwright/dashboard-${width}.png`, fullPage: true });
		}
		for (const width of [375, 768, 1366, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			for (const name of pages) {
				await nav.getByRole("link", { name, exact: true }).click();
				await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
				check(await nav.getByRole("link", { name, exact: true }).getAttribute("aria-current") === "page", `${name}菜单未选中`);
				check(await page.locator("main").getByText("状态码", { exact: true }).count() === 0, `${name}仍显示status字段`);
				check(!(await page.locator("main").innerText()).includes("运行时间"), `${name}仍显示系统运行时间`);
				const content = await page.locator("body").innerText();
				for (const note of ["原始值 · 格式待确认", "单位待确认", "0 为正常 · 其他保留原始代码", "单位按参考图标注", "表格可横向滚动", "采样范围 · 非额定量程", "北京时间 · 悬停"]) {
					check(!content.includes(note), `${name}仍显示说明文字：${note}`);
				}
				check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}/${name}页面横向溢出`);
			}
		}
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await nav.getByRole("link", { name: "运行指标", exact: true }).click();
		await page.getByRole("heading", { name: "运行指标", exact: true, level: 1 }).waitFor();
		check(await page.evaluate(() => window.scrollY === 0), "切换页面未回到顶部");
		check(await page.locator(".metric-card").count() === 18, "分组指标未覆盖18项");
		await page.screenshot({ path: "output/playwright/metrics.png", fullPage: true });
		await page.getByRole("link", { name: "查看电机温度趋势", exact: true }).click();
		await page.getByRole("heading", { name: "实时数据", exact: true, level: 1 }).waitFor();
		check(await page.getByRole("combobox", { name: "查看指标" }).inputValue() === "motor_temp", "指标跳转未选择对应曲线");
		await page.goBack();
		await page.getByRole("heading", { name: "运行指标", exact: true, level: 1 }).waitFor();
		await nav.getByRole("link", { name: "实时数据", exact: true }).click();
		await page.getByRole("combobox", { name: "查看指标" }).selectOption("speed");
		const chart = page.getByRole("group", { name: /设定转速与实际转速趋势/ });
		await chart.hover({ position: { x: 250, y: 100 } });
		await page.locator(".chart-tooltip").waitFor();
		check((await page.locator(".chart-tooltip").innerText()).includes("实际转速"), "悬停没有实际值");
		await chart.focus();
		await page.keyboard.press("Home");
		const first = await page.locator(".chart-tooltip").innerText();
		await page.keyboard.press("ArrowRight");
		check(await page.locator(".chart-tooltip").innerText() !== first, "键盘未切换采样");
		await page.keyboard.press("Escape");
		check(await page.locator(".chart-tooltip").count() === 0, "Esc未关闭提示");
		const metric = page.getByRole("combobox", { name: "查看指标" });
		await metric.selectOption("torque");
		await page.getByRole("group", { name: /设定转矩与实际转矩趋势/ }).waitFor();
		const fields = await metric.locator("optgroup[label='单项指标'] option").evaluateAll((options) => options.map((option) => option.value));
		check(fields.length === 18, "单项指标不是18个");
		for (const field of fields) {
			await metric.selectOption(field);
			check(await page.locator(".chart-surface svg path").count() === 1, `${field}曲线缺失`);
		}
		await metric.selectOption("speed");
		for (const limit of ["50", "200", "100"]) {
			await page.getByRole("combobox", { name: "采样条数" }).selectOption(limit);
			await page.getByText(new RegExp(`已返回 ${limit} 条记录`)).waitFor();
		}
		const device = page.getByRole("combobox", { name: "查看设备" });
		const source = page.getByRole("combobox", { name: "数据来源", exact: true });
		for (const motor of [2, 3, 4]) {
			await device.selectOption(String(motor));
			await page.getByRole("region", { name: "当前设备详情" }).getByRole("heading", { name: `G120电机${motor}`, exact: true }).waitFor();
			const content = await page.locator("main").innerText();
			check(![1, 2, 3, 4].some((other) => other !== motor && content.includes(`G120电机${other}`)), `电机${motor}页面混入其他电机`);
			check(await source.isDisabled(), "模拟电机来源选择未禁用");
			check(await source.inputValue() === "simulation", "模拟电机显示成历史来源");
			check(await source.locator("option[value='history']").count() === 0, "模拟电机仍可选历史真实来源");
			for (const name of pages) {
				await nav.getByRole("link", { name, exact: true }).click();
				await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
				check(await device.inputValue() === String(motor), "切换页面丢失设备选择");
				check((await page.locator(".device-detail").innerText()).includes(`G120电机${motor}`), "页面详情不是当前设备");
				const selectedContent = await page.locator("main").innerText();
				check(![1, 2, 3, 4].some((other) => other !== motor && selectedContent.includes(`G120电机${other}`)), `${name}混入其他电机`);
			}
			await nav.getByRole("link", { name: "实时数据", exact: true }).click();
		}
		await device.selectOption("1");
		await page.getByRole("region", { name: "当前设备详情" }).getByRole("heading", { name: "G120电机1", exact: true }).waitFor();
		await source.selectOption("history");
		await page.getByText("2026/01/14 18:27:24", { exact: true }).first().waitFor();
		await page.getByRole("button", { name: "刷新数据", exact: true }).click();
		await page.getByText("本次无新采样", { exact: true }).waitFor();
		check((await page.locator(".device-detail").innerText()).includes("历史真实采集"), "历史来源标识错误");
		await device.selectOption("2");
		await page.getByRole("heading", { name: "G120电机2", exact: true }).waitFor();
		check(await source.inputValue() === "simulation", "从历史电机1切到电机2时来源未更新");
		await device.selectOption("1");
		await page.getByText("2026/01/14 18:27:24", { exact: true }).first().waitFor();
		check(await source.inputValue() === "history", "返回电机1未恢复该电机来源选择");
		await nav.getByRole("link", { name: "设备概览", exact: true }).click();
		await page.getByRole("region", { name: "完整参数" }).waitFor();
		check(await page.locator(".parameter-grid > div").count() === 29, "设备概览隐藏status和运行时间后字段数量错误");
		const parameters = page.getByRole("region", { name: "完整参数", exact: true });
		check(JSON.stringify(await parameters.locator("h3").allTextContents()) === JSON.stringify(["设备信息", "采样信息", "运动参数", "电气参数", "功率参数", "温度参数", "负荷参数", "故障与控制"]), "完整参数分组错误");
		check(new Set(await parameters.locator("dt").allTextContents()).size === 29, "完整参数存在重复字段");
		check(!(await parameters.innerText()).includes("保留最新记录原值"), "完整参数标题下说明未删除");
		check((await parameters.innerText()).includes("实际转矩（N·m）"), "参数缺少转矩单位");
		await nav.getByRole("link", { name: "故障与报警", exact: true }).click();
		await page.getByRole("region", { name: "当前代码" }).waitFor();
		check(await page.locator(".code-grid .running-card").count() === 4, "移除status后代码卡片数量错误");
		check(await page.locator(".code-table table th").count() === 8, "代码记录的设备、变频器及代码字段数量错误");
		check((await page.locator(".code-grid").innerText()).includes("F01030"), "非零故障码未保留");
		check(await page.locator(".code-grid .running-card").filter({ has: page.getByText("报警码", { exact: true }) }).locator("strong").innerText() === "0", "历史采样中的零报警码未仅显示0");
		check(await page.locator(".code-table tbody tr").count() > 0, "代码采样记录未展示");
		await page.screenshot({ path: "output/playwright/codes.png", fullPage: true });
		await nav.getByRole("link", { name: "采样明细", exact: true }).click();
		await page.getByRole("region", { name: "原始采样明细" }).waitFor();
		check(await page.locator("details").getAttribute("open") !== null, "明细未默认展开");
		await page.locator("summary").focus();
		await page.keyboard.press("Enter");
		check(await page.locator("details").getAttribute("open") === null, "采样明细键盘未收起");
		await page.keyboard.press("Enter");
		check(await page.locator("details").getAttribute("open") !== null, "采样明细键盘未展开");
		check(await page.locator("table th").count() === 29, "采样明细隐藏status和运行时间后字段数量错误");
		check((await page.locator("table thead").innerText()).includes("实际电流（A）"), "采样明细缺少单位");
		await page.screenshot({ path: "output/playwright/records.png", fullPage: true });
		await nav.getByRole("link", { name: "实时数据", exact: true }).focus();
		await page.keyboard.press("Enter");
		await page.getByRole("heading", { name: "实时数据", exact: true, level: 1 }).waitFor();
		await source.selectOption("simulation");
		await page.locator(".sidebar-footer").filter({ hasText: "数据库查询成功" }).waitFor();
		await page.getByText("检测到新采样", { exact: true }).waitFor({ timeout: 12000 });
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.locator(".chart-surface svg").hover({ position: { x: 450, y: 120 } });
		await page.screenshot({ path: "output/playwright/trend-hover.png" });
		console.log("PASS: 六页导航与浏览器后退、375/768/1366/1920无横向溢出、跨页仅显示所选电机；单位标注、隐藏status、故障报警零值仅显示0及原码、18项分组与趋势跳转、29字段、6仪表、悬停、键盘、50/100/200、手动与自动刷新。");
	} finally {
		// 撤销测试视口并恢复真实窗口，避免最大化后仍按固定尺寸显示。
		await page.setViewportSize({ width: 0, height: 0 });
		try {
			await windowSession.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
			await windowSession.send("Browser.setWindowBounds", { windowId, bounds: bounds.windowState === "normal" ? bounds : { windowState: bounds.windowState } });
		} finally { await windowSession.detach(); }
	}
}
