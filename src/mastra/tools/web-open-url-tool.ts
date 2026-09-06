import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { looksLikeChallengePage } from './challenge-detection';

// 自建网页抓取工具，取代 ADR 0001 的 $web_search（多轮实测不可用，见 ADR 0002）。
// 只返回公开网页的原始 HTML：不执行 JS、不绕过登录/验证码、不下载文件。
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 50_000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
      }
    }
  }

  console.error(`${label} failed after retries:`, lastError);
  throw lastError;
}

export const webOpenUrlTool = createTool({
  id: 'web-open-url',
  description:
    '抓取指定公开网页的原始 HTML。跟随重定向，有超时保护。不能执行 JavaScript（看不到动态渲染内容），不能绕过登录/验证码，不能下载文件（PDF、图片、视频等），部分站点会拦截返回 403。',
  inputSchema: z.object({
    url: z.url().describe('要抓取的公开网页 URL'),
  }),
  outputSchema: z.union([
    z.object({
      ok: z.literal(true),
      url: z.string(),
      finalUrl: z.string().describe('跟随重定向后的最终地址'),
      status: z.number(),
      contentType: z.string(),
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

    let response: Response;
    try {
      response = await withRetry(async () => {
        const result = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        // 5xx 值得重试；4xx（403/404 等）重试无意义，直接返回给外层处理
        if (result.status >= 500) {
          throw new Error(`HTTP ${result.status}`);
        }
        return result;
      }, 'Web page request');
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return { ok: false as const, url, error: `请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）` };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, url, error: `请求失败：${message}` };
    }

    if (!response.ok) {
      const error =
        response.status === 403
          ? 'HTTP 403：该站点拦截了非浏览器请求或需要验证'
          : `HTTP ${response.status}`;
      return { ok: false as const, url, error };
    }

    // content-type 缺失不等于非 HTML——豆瓣安全校验页等响应就不带该头；
    // 先读 body，再按挑战页特征判断，给出准确错误而不是"未知内容类型"
    const contentType = response.headers.get('content-type') ?? '';
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml')
    ) {
      return {
        ok: false as const,
        url,
        error: `不支持的内容类型（${contentType}），仅支持网页 HTML`,
      };
    }

    const rawHtml = await response.text();
    if (looksLikeChallengePage(response.url, rawHtml)) {
      return {
        ok: false as const,
        url,
        error: '站点返回了反爬安全验证页（无法直接抓取），请改用 webOpenUrlRendered（无头浏览器）重试',
      };
    }
    const truncated = rawHtml.length > MAX_HTML_CHARS;

    return {
      ok: true as const,
      url,
      finalUrl: response.url,
      status: response.status,
      contentType,
      html: truncated ? rawHtml.slice(0, MAX_HTML_CHARS) : rawHtml,
      truncated,
    };
  },
});
