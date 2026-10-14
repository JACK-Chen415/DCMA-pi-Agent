async (page) => {
	const key = "dcma.communication-config.v1";
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const originalViewport = page.viewportSize();
	await page.goto("http://127.0.0.1:3000/#communication");
	const originalSettings = await page.evaluate((key) => localStorage.getItem(key), key);
	const errors = [];
	const captureError = (error) => errors.push(error.message);
	page.on("pageerror", captureError);
	let queries = 0;
	const countQuery = (request) => { if (request.url().includes("/api/database/")) queries++; };
	page.on("request", countQuery);
	try {
		await page.evaluate((key) => localStorage.removeItem(key), key);
		await page.reload();
		const nav = page.getByRole("navigation", { name: "监控页面" });
		check(await nav.getByRole("link").count() === 7, "菜单应保持七项");
		check(await nav.getByRole("link", { name: "数据说明" }).count() === 0, "数据说明未移除");
		const settingsNav = page.getByRole("navigation", { name: "系统配置子菜单" });
		const sections = ["系统状态", "授权配置", "设备配置", "监控配置", "通信配置", "自定义实时数据", "语言/Language", "其他设置"];
		check(await settingsNav.getByRole("link").count() === 8, "系统配置八个子菜单不完整");
		for (const title of sections) {
			await settingsNav.getByRole("link", { name: title, exact: true }).click();
			check(await settingsNav.getByRole("link", { name: title, exact: true }).getAttribute("aria-current") === "page", `${title}子菜单未选中`);
			await page.getByRole("heading", { name: title, exact: true, level: 2 }).waitFor();
			if (title === "设备配置") check(await page.getByRole("region", { name: "设备配置", exact: true }).locator("tbody tr").count() === 5, "设备来源核对缺少五个来源");
			else if (title !== "通信配置") check(await page.getByText("页面内容待补充。", { exact: true }).count() === 1, `${title}应保留待补充页面`);
		}
		await settingsNav.getByRole("link", { name: "通信配置", exact: true }).click();
		await settingsNav.getByRole("link", { name: "系统状态", exact: true }).click();
		await page.goBack();
		await page.getByRole("heading", { name: "通信配置", exact: true, level: 2 }).waitFor();
		check(await page.locator(".communication-parameter").count() === 20, "参考图参数不完整");
		check(await page.getByRole("button", { name: "ALM数据 · 待补充" }).isDisabled(), "未提供字段的分组不应伪造配置");
		await page.waitForTimeout(3500);
		check(queries === 0, "配置页不应查询数据库");
		for (const width of [1920, 1366, 768, 375]) {
			await page.setViewportSize({ width, height: 1000 });
			check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}配置页横向溢出`);
			await page.screenshot({ path: `output/playwright/communication-${width}.png`, fullPage: true });
		}
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.getByLabel("服务器 IP 地址 / 主机名").fill("broker.example.test");
		await page.getByLabel("服务器用户名").fill("preview-user");
		await page.getByLabel("服务器密码").fill("test-only-password");
		await page.getByLabel("数据发送周期").fill("5");
		await page.getByRole("combobox", { name: "单位", exact: true }).selectOption("分钟");
		await page.getByLabel("数据记录订阅主题").fill("test/records");
		await page.getByLabel("实时数据订阅主题").fill("test/live");
		await page.getByLabel("记录日期参数名称").fill("RecordedAt");
		await page.getByRole("checkbox", { name: "正向速度最大值", exact: true }).uncheck();
		check(await page.getByLabel("正向速度最大值参数名称").isDisabled(), "取消勾选后名称应禁用");
		await page.getByRole("button", { name: "逆变器数据", exact: true }).click();
		check(await page.locator(".communication-parameter").count() === 29, "逆变器字段与当前展板不一致");
		await page.getByLabel("实际电流参数名称").fill("CurrentActual");
		await page.getByRole("button", { name: "保存本机配置", exact: true }).click();
		check((await page.getByRole("status").innerText()).includes("配置已保存"), "保存未成功");
		const saved = await page.evaluate((key) => localStorage.getItem(key), key);
		check(!saved.includes("test-only-password") && !("password" in JSON.parse(saved)), "密码不应持久保存");
		await page.reload();
		check(await page.getByLabel("服务器 IP 地址 / 主机名").inputValue() === "broker.example.test", "刷新丢失服务器设置");
		check(await page.getByLabel("服务器用户名").inputValue() === "preview-user", "刷新丢失用户名");
		check(await page.getByLabel("服务器密码").inputValue() === "", "刷新仍保留密码");
		check(await page.getByLabel("数据发送周期").inputValue() === "5" && await page.getByRole("combobox", { name: "单位", exact: true }).inputValue() === "分钟", "刷新丢失周期");
		check(await page.getByLabel("记录日期参数名称").inputValue() === "RecordedAt", "刷新丢失参数名称");
		check(!await page.getByRole("checkbox", { name: "正向速度最大值", exact: true }).isChecked(), "刷新丢失参数勾选状态");
		await page.getByRole("button", { name: "逆变器数据", exact: true }).click();
		check(await page.getByLabel("实际电流参数名称").inputValue() === "CurrentActual", "刷新丢失另一分组设置");
		await page.getByLabel("服务器端口").fill("0");
		await page.getByRole("button", { name: "保存本机配置", exact: true }).click();
		check(await page.evaluate((key) => localStorage.getItem(key), key) === saved, "非法端口不应保存");
		await page.getByLabel("服务器端口").fill("1883");
		await page.getByRole("button", { name: "数据记录", exact: true }).click();
		await page.getByLabel("记录日期参数名称").fill(" ");
		await page.getByRole("button", { name: "逆变器数据", exact: true }).click();
		await page.getByRole("button", { name: "保存本机配置", exact: true }).click();
		check((await page.getByRole("status").innerText()).includes("请填写已勾选参数"), "未检查隐藏分组的空参数名称");
		check(await page.getByRole("button", { name: "数据记录", exact: true }).getAttribute("aria-pressed") === "true", "未跳到无效参数分组");
		await page.reload();
		await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Test storage unavailable", "QuotaExceededError"); }; });
		await page.getByRole("button", { name: "保存本机配置", exact: true }).click();
		check((await page.getByRole("status").innerText()).includes("保存失败"), "存储不可写时不应声称保存成功");
		await page.reload();
		for (const invalid of ["{", JSON.stringify({ ...JSON.parse(saved), parameters: [[null], []] })]) {
			await page.evaluate(({ key, invalid }) => localStorage.setItem(key, invalid), { key, invalid });
			await page.reload();
			check((await page.getByRole("status").innerText()).includes("无法读取本机配置"), "损坏配置未提示");
			check(await page.locator(".communication-parameter").count() === 20, "损坏配置应恢复默认页面");
		}
		await page.goto("http://127.0.0.1:3000/#guide");
		await page.getByRole("heading", { name: "系统配置", exact: true, level: 1 }).waitFor();
		await nav.getByRole("link", { name: "实时数据", exact: true }).click();
		await page.locator(".sidebar-footer").filter({ hasText: "数据库查询成功" }).waitFor();
		check(await page.locator(".gauge-card").count() === 6, "返回监控后仪表缺失");
		await nav.getByRole("link", { name: "系统配置", exact: true }).focus();
		await page.keyboard.press("Enter");
		await page.getByRole("heading", { name: "系统配置", exact: true, level: 1 }).waitFor();
		check(errors.length === 0, `页面运行错误：${errors.join("；")}`);
		console.log("PASS: 通信配置本机保存与刷新、密码不保存、跨分组编辑、端口/名称校验、存储异常恢复、导航与监控恢复、375/768/1366/1920布局。");
	} finally {
		page.off("pageerror", captureError);
		page.off("request", countQuery);
		await page.reload();
		await page.evaluate(({ key, originalSettings }) => {
			if (originalSettings === null) localStorage.removeItem(key); else localStorage.setItem(key, originalSettings);
		}, { key, originalSettings });
		if (originalViewport) await page.setViewportSize(originalViewport);
		await page.reload();
	}
}
