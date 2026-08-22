/* Headless Edge visual check for the workspace layout (desktop + mobile). */
const { chromium } = require("playwright-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://localhost:5173";

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: "desktop.png" });

  // Project context menu open
  await page.click(".context-picker");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "desktop-menu.png" });
  await page.keyboard.press("Escape");

  // New project dialog
  await page.click(".context-picker");
  await page.waitForTimeout(200);
  await page.click("text=新建项目");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "desktop-dialog.png" });
  await page.keyboard.press("Escape");

  // Mobile layout + drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "mobile.png" });
  await page.click(".mobile-menu", { force: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "mobile-drawer.png" });

  await browser.close();
  console.log("screenshots done");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
