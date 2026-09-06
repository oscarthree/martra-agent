import { createTool } from '@mastra/core/tools';
import { chromium, type Browser } from 'playwright';
import { z } from 'zod';
import { looksLikeChallengePage } from './challenge-detection';

// 无头浏览器抓取工具（ADR 0003）：用于 webOpenUrl 搞不定的站点——需要执行
// JS 的动态页面，以及豆瓣这类前置 JS 挑战（sec.douban.com）的反爬网关。
// 浏览器实例进程级复用，每次请求开独立 context 隔离 Cookie/会话。
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 10_000;
const MAX_HTML_CHARS = 50_000;

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true });
  return browserPromise;
}

// page.content() 在页面正在导航时会抛 "Unable to retrieve content..."——
// 挑战页跳回目标页常撞在这个时间窗上。遇到这种情况等导航落地再重试。
async function readContentWhenStable(
  page: import('playwright').Page,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await page.content();
    } catch (error) {
      lastError = error;
      const navigating =
        error instanceof Error && error.message.includes('page is navigating');
      if (!navigating) throw error;
      await page
        .waitForLoadState('domcontentloaded', { timeout: SETTLE_TIMEOUT_MS })
        .catch(() => {});
    }
  }
  throw lastError;
}

export const webOpenUrlRenderedTool = createTool({
  id: 'web-open-url-rendered',
  description:
    '用无头浏览器打开指定网页并返回 JS 执行后的渲染 HTML。适用于 webOpenUrl 失败的场景：JS 动态渲染的页面、带反爬 JS 挑战的站点（如豆瓣）。比 webOpenUrl 慢，优先用 webOpenUrl。仍无法绕过登录/验证码，部分站点会识别并拦截无头浏览器。',
  inputSchema: z.object({
    url: z.url().describe('要抓取的公开网页 URL'),
  }),
  outputSchema: z.union([
    z.object({
      ok: z.literal(true),
      url: z.string(),
      finalUrl: z.string().describe('跳转/重定向后的最终地址'),
      status: z.number().nullable(),
      title: z.string(),
      html: z.string(),
      truncated: z.boolean().describe('HTML 是否因超长被截断'),
    }),
    z.object({
      ok: z.literal(false),
      url: z.string(),
      error: z.string(),
    }),
  ]),
  execute: async (inputData) => {
    const { url } = inputData;

    let context;
    try {
      const browser = await getBrowser();
      context = await browser.newContext({ locale: 'zh-CN' });
      const page = await context.newPage();

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      // JS 挑战页会先种 Cookie 再跳回目标页，等网络静默让跳转完成；
      // 超时只说明页面有长连接或持续加载，不影响取当前 DOM
      await page
        .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
        .catch(() => {});

      let rawHtml = await readContentWhenStable(page);

      // 仍停在挑战页：等它自动跳回，没跳就带已种的 Cookie 手动重进目标页
      for (let retry = 0; retry < 2 && looksLikeChallengePage(page.url(), rawHtml); retry += 1) {
        const challengeHost = URL.parse(page.url())?.host;
        await page
          .waitForURL((u) => u.host !== challengeHost, {
            timeout: SETTLE_TIMEOUT_MS,
          })
          .catch(() => {});
        if (URL.parse(page.url())?.host === challengeHost) {
          await page
            .goto(url, {
              waitUntil: 'domcontentloaded',
              timeout: NAVIGATION_TIMEOUT_MS,
            })
            .catch(() => {});
        }
        await page
          .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
          .catch(() => {});
        rawHtml = await readContentWhenStable(page);
      }

      if (looksLikeChallengePage(page.url(), rawHtml)) {
        return {
          ok: false as const,
          url,
          error: `站点反爬校验未通过，仍停留在验证页（${URL.parse(page.url())?.host ?? page.url()}），无法获取真实内容`,
        };
      }
      const truncated = rawHtml.length > MAX_HTML_CHARS;

      return {
        ok: true as const,
        url,
        finalUrl: page.url(),
        status: response?.status() ?? null,
        title: await page.title(),
        html: truncated ? rawHtml.slice(0, MAX_HTML_CHARS) : rawHtml,
        truncated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout =
        error instanceof Error && error.name === 'TimeoutError';
      return {
        ok: false as const,
        url,
        error: isTimeout
          ? `页面加载超时（${NAVIGATION_TIMEOUT_MS / 1000} 秒）`
          : `浏览器抓取失败：${message}`,
      };
    } finally {
      await context?.close().catch(() => {});
    }
  },
});
