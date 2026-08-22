/* Ticket 05 acceptance: dialog validation, keyboard/focus, reduced-motion,
   send-failure inline retry/dismiss, real streaming chat, snapshot recovery. */
const { chromium } = require("playwright-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://localhost:5173";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  // 全新工作区，避免历史数据干扰
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  // 1. 项目名空/重复校验：错误显示、弹窗保持打开、高度不跳动
  await page.click(".context-picker");
  await page.click("text=新建项目");
  await page.waitForSelector(".modal");
  const heightBefore = await page.evaluate(() => document.querySelector(".modal").offsetHeight);
  await page.click(".modal-actions .primary");
  const emptyError = await page.textContent(".field-error");
  check("空项目名显示错误", emptyError.trim() === "请输入项目名称", emptyError);
  await page.fill(".modal input", "天气助手");
  await page.click(".modal-actions .primary");
  const dupError = await page.textContent(".field-error");
  check("重复项目名显示错误", dupError.trim() === "项目已存在", dupError);
  const heightAfter = await page.evaluate(() => document.querySelector(".modal").offsetHeight);
  check("弹窗错误时布局不跳动", heightBefore === heightAfter, `${heightBefore} -> ${heightAfter}`);
  check("错误时弹窗保持打开", await page.isVisible(".modal"));
  await page.screenshot({ path: "accept-dialog-error.png" });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal", { state: "detached" });

  // 2. 键盘：菜单 Escape 关闭且焦点回到触发按钮；方向键移动焦点
  await page.focus(".context-picker");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".context-menu");
  await page.keyboard.press("ArrowDown");
  const focusInsideMenu = await page.evaluate(() =>
    document.querySelector(".context-menu").contains(document.activeElement));
  check("方向键焦点进入菜单", focusInsideMenu);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".context-menu", { state: "detached" });
  const focusBack = await page.evaluate(() =>
    document.activeElement === document.querySelector(".context-picker"));
  check("菜单关闭后焦点返回选择器", focusBack);

  // 3. 发送失败：拦截 /api/copilotkit 注入失败，内联提示可重试可关闭
  await page.route("**/api/copilotkit**", (route) => route.abort());
  await page.fill(".chat-panel textarea", "这条会失败");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".send-error", { timeout: 15000 });
  const errorText = await page.textContent(".send-error");
  check("发送失败内联提示", errorText.includes("发送失败"), errorText.trim());
  check("提供重试与关闭操作",
    errorText.includes("重试") && errorText.includes("关闭"));
  await page.screenshot({ path: "accept-send-error.png" });
  await page.click(".send-error button[aria-label='关闭错误提示']");
  await page.waitForSelector(".send-error", { state: "detached" });
  check("关闭后错误提示消失", true);
  await page.unroute("**/api/copilotkit**");
  // 失败留下的用户消息保留输入区可用
  check("错误状态保留输入区", await page.isVisible(".chat-panel textarea"));

  // 4. 移动端抽屉：键盘打开、Tab 囚禁在抽屉内、Escape 关闭、焦点返回菜单按钮
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.focus(".mobile-menu");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".drawer-panel");
  let trapped = true;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      document.querySelector(".drawer-panel").contains(document.activeElement));
    if (!inside) { trapped = false; break; }
  }
  check("Tab 焦点囚禁在抽屉内（30 次）", trapped);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel", { state: "detached" });
  const focusOnMenu = await page.evaluate(() =>
    document.activeElement === document.querySelector(".mobile-menu"));
  check("抽屉关闭后焦点返回菜单按钮", focusOnMenu);

  // 5. reduced-motion：动画与过渡都应关闭
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.evaluate(() => ({
    animation: getComputedStyle(document.querySelector(".workspace")).animationName,
    transition: getComputedStyle(document.querySelector(".new-chat")).transitionDuration,
  }));
  check("reduced-motion 关闭动画与过渡",
    motion.animation === "none" && motion.transition === "0s",
    JSON.stringify(motion));
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // 6. 真实流式聊天：断言落在助手回复内容（天气数据关键词），用户消息无法满足
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.click(".chat-panel textarea");
  await page.fill(".chat-panel textarea", "北京现在的天气怎么样？");
  await page.keyboard.press("Enter");
  let streamed = true;
  let replySample = "";
  try {
    await page.waitForFunction(() => {
      const text = document.querySelector(".chat-scroll").innerText;
      // 助手回复必含天气数据（°C/湿度/风速）或思考块标识；用户消息与欢迎文案都没有
      return /°C|湿度|风速|Thinking|Thought/.test(text);
    }, { timeout: 90000 });
    replySample = await page.evaluate(() =>
      document.querySelector(".chat-scroll").innerText.replace(/\n/g, " ").slice(0, 140));
  } catch {
    streamed = false;
  }
  check("真实流式聊天收到助手回复", streamed, replySample);
  await page.screenshot({ path: "accept-chat.png" });

  // 7. 快照恢复：刷新后等待回填，消息仍在
  await page.reload({ waitUntil: "networkidle" });
  let restored = true;
  try {
    await page.waitForFunction(() =>
      document.querySelector(".chat-scroll")?.innerText.includes("北京现在的天气怎么样"),
      { timeout: 15000 });
  } catch {
    restored = false;
  }
  check("刷新后恢复 Message Snapshot", restored);
  await page.screenshot({ path: "accept-restored.png" });

  // 8. 最终布局截图（移动端）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "accept-mobile.png" });

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
