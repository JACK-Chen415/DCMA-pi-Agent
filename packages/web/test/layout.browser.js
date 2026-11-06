// Run against isolated Vite servers on 3100 (chat) and 3101 (dashboard):
// playwright-cli -s=mspic run-code --filename packages/web/test/layout.browser.js
async (page) => {
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  const stamp = new Date().toISOString();
  const ids = {
    old: '11111111-1111-4111-8111-111111111111',
    latest: '22222222-2222-4222-8222-222222222222',
    oldEvidence: '33333333-3333-4333-8333-333333333333',
    latestEvidence: '44444444-4444-4444-8444-444444444444',
  };
  const answer = (id, text, tool, evidenceId) => ({ id, role: 'assistant', content: text, timestamp: stamp, status: 'done', steps: [{ callId: id, tool, status: 'done', durationMs: 234, evidenceId }] });
  let saved = { version: 1, revision: 0, activeId: null, deviceId: 'real_data_01', conversations: [
    { id: 'a', title: '运行分析记录', deviceId: 'real_data_01', time: stamp, messages: [
      { id: 'question-1', role: 'user', content: '查看设备资料', timestamp: stamp, status: 'done' },
      answer(ids.old, '已读取设备资料，设备身份仍需现场确认。', 'get_device_profile', ids.oldEvidence),
      { id: 'question-2', role: 'user', content: '分析最近一小时运行情况', timestamp: stamp, status: 'done' },
      answer(ids.latest, '最近一小时电机温度均值为46℃。本例为界面验收模拟结果。', 'summarize_metrics', ids.latestEvidence),
    ] },
    { id: 'b', title: '知识查询记录', deviceId: 'real_data_02', time: stamp, messages: [{ id: 'plain-answer', role: 'assistant', content: '请先确认故障码和适用型号。', timestamp: stamp, status: 'done' }] },
  ] };
  const tables = ['real_data_01', 'real_data_02', 'real_data_03', 'real_data_04', 'real_data'];
  const sample = (table) => ({ id: '1', acquiredAt: stamp, ingestedAt: stamp, raw: { id: '1', device_name: `G120电机${table === 'real_data' ? 1 : Number(table.slice(-2))}`, inverter_name: '模拟变频器', fault_code: '0', alarm_code: '0', timestamp: stamp }, values: { speed_actual: 980, speed_setpoint: 1000, current_actual: 1.2, torque_actual: 2.5, dc_voltage: 540, inverter_temp: 37, motor_temp: 46 } });
  const sources = () => tables.map((table, index) => ({ table, deviceIndex: index === 4 ? 1 : index + 1, kind: index === 4 ? 'acquired' : 'simulation', available: true, latest: sample(table), message: '隔离模拟接口', assessment: { state: 'unknown', label: index === 4 ? '历史采集' : '状态未确认', tone: 'neutral', detail: '界面模拟数据，不能确认现场运行状态。', latestAt: stamp, assessedAt: stamp, expiresAt: null } }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('dcma-workspace-v1', JSON.stringify({ settings: { model: 'mock/model', telemetryIntervalMs: 5000 }, deviceId: 'real_data_01' }));
    localStorage.removeItem('dcma-conversations-pending-v1');
    const original = window.fetch.bind(window);
    window.__chatPayloads = [];
    window.__cancels = 0;
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      if (url.pathname === '/api/chat' && options?.method === 'POST') {
        window.__chatPayloads.push(JSON.parse(options.body));
        return new Response(new ReadableStream({ start(controller) { window.__chatStream = controller; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      if (url.pathname.startsWith('/api/chat/') && options?.method === 'DELETE') {
        window.__cancels++;
        window.__chatStream.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'cancelled' }) + '\n'));
        window.__chatStream.close();
        return Response.json({ cancelled: true });
      }
      return original(input, options);
    };
    window.__event = (event, close = false) => {
      window.__chatStream.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
      if (close) window.__chatStream.close();
    };
  });
  let oldEvidenceReady = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/health') return json({ connected: true, models: [{ id: 'mock/model', name: '模拟模型' }], message: '隔离验收' });
    if (url.pathname === '/api/conversations') {
      if (request.method() === 'PUT') { saved = { ...request.postDataJSON(), revision: saved.revision + 1 }; return json({ revision: saved.revision }); }
      return json(saved);
    }
    if (url.pathname === '/api/database/dashboard') {
      const table = url.searchParams.get('table'), latest = sample(table);
      return json({ schema: 'dcma', table, limit: Number(url.searchParams.get('limit')), queriedAt: stamp, sources: sources(), latest, records: [latest], samples: [latest], returned: 1, hasMore: false, truncated: false, warnings: [] });
    }
    if (url.pathname.startsWith('/api/tools/evidence/')) {
      const id = url.pathname.split('/').at(-1).replace('.json', '');
      if (id === ids.old && !oldEvidenceReady) return json({ error: '模拟证据暂不可读' }, 503);
      const old = id === ids.old;
      return json({ version: 1, requestId: id, records: [{ id: old ? ids.oldEvidence : ids.latestEvidence, tool: old ? 'get_device_profile' : 'summarize_metrics', createdAt: stamp, input: {}, result: { table: old ? 'real_data_02' : 'real_data_01', records: old ? 17 : 3600, complete: true } }] });
    }
    if (url.pathname === '/api/database/code-events') return json({ events: [], total: 0, page: 1, pageSize: 50, codes: [], warnings: [], summary: {} });
    throw new Error(`Unexpected API: ${request.method()} ${url.pathname}`);
  });
  const home = 'http://127.0.0.1:3100/';
  const shot = (name) => page.screenshot({ path: `output/playwright/mspic-${name}.png`, fullPage: true });
  const layout = async (label) => {
    const bounds = await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      header: document.querySelector('.app-header').getBoundingClientRect().top,
      inputBottom: document.querySelector('.chat-composer').getBoundingClientRect().bottom,
      height: innerHeight,
    }));
    ensure(bounds.width <= bounds.viewport, `${label}: horizontal overflow ${JSON.stringify(bounds)}`);
    ensure(bounds.header === 0 && bounds.inputBottom <= bounds.height, `${label}: fixed regions moved`);
  };
  const openConversation = async (name) => {
    if (!await page.getByRole('complementary', { name: '会话历史' }).isVisible()) await page.getByRole('button', { name: '展开会话历史' }).click();
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  };
  const layouts = [];
  for (const [width, height] of [[1920, 1080], [1366, 900], [768, 1024], [375, 812]]) {
    saved = { ...saved, activeId: null, deviceId: 'real_data_01' };
    await page.setViewportSize({ width, height });
    await page.goto(home);
    await page.getByRole('heading', { name: /我是 MSPIC-AI/ }).waitFor();
    ensure(await page.locator('.suggestion-group button').count() === 12, 'expected twelve quick questions');
    ensure(!await page.getByRole('complementary', { name: '分析过程' }).count(), 'welcome must not reserve analysis panel');
    await layout(`home-${width}`);
    await shot(`home-${width}`);
    await openConversation('运行分析记录');
    await page.getByText('最近一小时电机温度均值为46℃。本例为界面验收模拟结果。', { exact: true }).waitFor();
    if (width < 1280) await page.getByRole('button', { name: '打开分析过程', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '分析过程' });
    await panel.getByText('统计指标', { exact: true }).waitFor();
    await panel.getByText('3,600 条', { exact: true }).waitFor();
    await layout(`chat-${width}`);
    await shot(`chat-${width}`);
    if (width < 1280) {
      await page.getByRole('button', { name: '关闭分析过程', exact: true }).click();
      ensure(!await panel.isVisible(), 'analysis drawer must close');
    } else {
      const before = await page.locator('.chat-main').boundingBox();
      await page.getByRole('button', { name: '收起会话历史' }).click();
      const after = await page.locator('.chat-main').boundingBox();
      ensure(after.width > before.width, 'collapse must expand the chat');
      await page.getByRole('button', { name: '展开会话历史' }).click();
    }
    layouts.push(`${width}x${height}`);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: '查看分析过程', exact: true }).first().click();
  const panel = page.getByRole('complementary', { name: '分析过程' });
  await panel.getByRole('button', { name: '重试读取' }).waitFor();
  oldEvidenceReady = true;
  await panel.getByRole('button', { name: '重试读取' }).click();
  await panel.getByText('17 条', { exact: true }).waitFor();
  ensure(!await panel.getByText('3,600 条', { exact: true }).count(), 'old and latest evidence must not mix');
  await openConversation('知识查询记录');
  await panel.getByText('本轮无工具调用记录。', { exact: true }).waitFor();
  await openConversation('运行分析记录');
  await panel.getByText('3,600 条', { exact: true }).waitFor();
  let sends = 0;
  const send = async (text) => {
    await page.getByRole('textbox', { name: '问题输入', exact: true }).fill(text);
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await page.getByRole('button', { name: '停止生成', exact: true }).waitFor();
    await page.waitForFunction((count) => window.__chatPayloads.length === count, ++sends);
  };
  await send('验收流式工具步骤');
  await page.evaluate(() => window.__event({ type: 'tool_start', tool: 'summarize_metrics', callId: 'stream-step' }));
  await panel.getByText('正在统计指标…', { exact: false }).waitFor();
  await openConversation('知识查询记录');
  ensure(await page.evaluate(() => window.__cancels) === 0, 'conversation switch must not cancel generation');
  await page.evaluate(() => { window.__event({ type: 'tool_end', tool: 'summarize_metrics', callId: 'stream-step', ok: true, durationMs: 420 }); window.__event({ type: 'delta', text: '后台生成验收完成。' }); window.__event({ type: 'done' }, true); });
  await openConversation('运行分析记录');
  await page.getByText('后台生成验收完成。', { exact: true }).waitFor();
  await panel.getByText('统计指标', { exact: true }).waitFor();
  await send('验收显式停止');
  await page.evaluate(() => window.__event({ type: 'tool_start', tool: 'get_device_profile', callId: 'stopped-step' }));
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByText('生成已停止', { exact: true }).waitFor();
  await panel.getByText('已中断', { exact: true }).waitFor();
  await send('验收工具失败');
  await page.evaluate(() => { window.__event({ type: 'tool_start', tool: 'read_industrial_rows', callId: 'failed-step' }); window.__event({ type: 'tool_end', tool: 'read_industrial_rows', callId: 'failed-step', ok: false, error: '模拟查询超时', durationMs: 100 }); window.__event({ type: 'error', message: '模拟请求失败' }, true); });
  await panel.getByText('失败原因：模拟查询超时', { exact: true }).waitFor();
  await page.getByRole('button', { name: '上传遥测日志或设备档案 (CSV/LOG)' }).click();
  await page.getByRole('dialog', { name: /导入数据/ }).waitFor();
  await page.getByLabel('选择监测数据文件').setInputFiles({ name: 'check.csv', mimeType: 'text/csv', buffer: Buffer.from(`timestamp,temperature,current,speed\n${stamp},46,1.2,980\n`) });
  await page.getByRole('button', { name: '返回数据库数据', exact: true }).click();
  await page.getByText('已返回数据库数据；原始上传文件不会被修改', { exact: true }).waitFor();
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '切换设备', exact: true });
  ensure(await picker.locator('.device-picker-option').count() === 5, 'chat must offer all five sources');
  await picker.getByRole('button', { name: /real_data_01/ }).click();
  ensure(await page.getByText('本次请求失败，可重新发送', { exact: true }).count() === 1, 'same-device selection must preserve conversation');
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await picker.getByRole('button', { name: /real_data_03/ }).click();
  await page.getByRole('heading', { name: /我是 MSPIC-AI/ }).waitFor();
  ensure((await page.locator('.suggestion-group button').first().textContent()).includes('G120电机3'), 'quick questions must follow selected device');
  await page.locator('.suggestion-group button').first().click();
  await page.waitForFunction((count) => window.__chatPayloads.length === count, ++sends);
  ensure((await page.evaluate(() => window.__chatPayloads.at(-1).text)).includes('G120电机3'), 'quick question must submit the selected device');
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await picker.getByRole('button', { name: /real_data_03/ }).click();
  ensure(await page.evaluate(() => window.__cancels) === 1, 'same-device selection must not cancel the running request');
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await picker.getByRole('button', { name: /real_data_02/ }).click();
  await page.waitForFunction(() => window.__cancels === 2);
  await page.getByRole('heading', { name: /我是 MSPIC-AI/ }).waitFor();
  await page.getByRole('button', { name: '实时数据', exact: true }).click();
  await page.waitForURL('**/dashboard/?table=real_data_02#realtime');
  await page.goto('http://127.0.0.1:3101/dashboard/?table=real_data_02#realtime');
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await picker.waitFor();
  ensure(await picker.locator('.device-picker-option').count() === 5, 'dashboard must use all five shared choices');
  ensure(await picker.getByRole('button', { name: /real_data_02/ }).getAttribute('aria-pressed') === 'true', 'dashboard must select the passed source');
  ensure(await picker.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), 'device images must load');
  await shot('devices');
  await picker.getByRole('button', { name: /历史采集 · real_data/ }).click();
  await page.getByText('历史记录 · 非当前工况', { exact: true }).waitFor();
  ensure(new URL(page.url()).searchParams.get('table') === 'real_data', 'history source must update URL');
  await page.reload();
  await page.getByText('历史记录 · 非当前工况', { exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await picker.waitFor();
  await shot('devices-375');
  ensure(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'dashboard picker must not cause overflow');
  await page.keyboard.press('Escape');
  ensure(!await picker.count(), 'Escape must dismiss shared picker');
  ensure(errors.length === 0, `browser errors: ${errors.join('; ')}`);
  return { layouts, welcome: 'passed', collapse: 'passed', historyEvidenceAndRetry: 'passed', streaming: 'passed', backgroundGeneration: 'passed', cancellation: 'passed', toolFailure: 'passed', importAndRestore: 'passed', quickQuestions: 'passed', deviceSwitchAndNavigation: 'passed', dashboardHistoryReload: 'passed', browserErrors: errors };
}
