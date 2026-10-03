# 工具层

> C4 层级：**C3 Component**（Agent 可调用的外部能力组件）。

## 1. 职责

Tool 层封装所有外部数据获取能力，供 Agent 按需调用：

- `weatherTool`：获取指定地点当前天气。
- `webOpenUrl`：裸 fetch 抓取公开网页原始 HTML。
- `webOpenUrlRendered`：Playwright 无头浏览器渲染抓取。
- `challenge-detection`：识别反爬挑战页。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/mastra/tools/weather-tool.ts` | 当前天气工具 |
| `src/mastra/tools/web-open-url-tool.ts` | 裸 fetch 网页抓取 |
| `src/mastra/tools/web-open-url-rendered-tool.ts` | 无头浏览器渲染抓取 |
| `src/mastra/tools/challenge-detection.ts` | 反爬挑战页识别 |

## 3. 工具一览

### 3.1 weatherTool

| 属性 | 说明 |
| --- | --- |
| id | `get-weather` |
| 输入 | `{ location: string }` |
| 输出 | `{ temperature, feelsLike, humidity, windSpeed, windGust, conditions, location }` |
| 外部依赖 | Open-Meteo Geocoding + Forecast API |

流程：
1. 地理编码获取经纬度与城市名。
2. 调用 forecast API 获取当前天气。
3. 将 `weather_code` 转换为中文天气状况。

### 3.2 webOpenUrlTool

| 属性 | 说明 |
| --- | --- |
| id | `web-open-url` |
| 输入 | `{ url: string }`（zod `z.url()`） |
| 输出 | 联合类型：`{ ok: true, url, finalUrl, status, contentType, html, truncated }` 或 `{ ok: false, url, error }` |
| 外部依赖 | 目标网站 |

特性：
- 浏览器-like User-Agent。
- 15 秒超时，5xx 指数退避重试（最多 3 次）。
- 超长 HTML 截断至 50,000 字符。
- 识别反爬挑战页并引导使用 `webOpenUrlRendered`。

### 3.3 webOpenUrlRenderedTool

| 属性 | 说明 |
| --- | --- |
| id | `web-open-url-rendered` |
| 输入 | `{ url: string }` |
| 输出 | `{ ok: true, url, finalUrl, status, title, html, truncated }` 或 `{ ok: false, url, error }` |
| 外部依赖 | Playwright headless Chromium |

特性：
- 浏览器实例进程级懒加载复用。
- 每次请求新建独立 `BrowserContext`，隔离 Cookie/会话。
- 等待 `domcontentloaded` + `networkidle`，处理 JS 挑战页跳转。
- 仍停在挑战页时最多 2 次重进，最终失败返回明确错误。

### 3.4 challenge-detection

| 函数 | 说明 |
| --- | --- |
| `looksLikeChallengePage(url, html)` | 判断是否为 `sec.douban.com` 或含安全检查/Checking your browser 等关键词的小页面 |

## 4. 关键类 / 函数

| 名称 | 来源 | 作用 |
| --- | --- | --- |
| `createTool` | `@mastra/core/tools` | 定义 Tool |
| `withRetry` | 各工具内部实现 | 指数退避重试 |
| `getBrowser` | `web-open-url-rendered-tool.ts` | 进程级复用 Playwright browser |
| `readContentWhenStable` | `web-open-url-rendered-tool.ts` | 页面导航落地后安全读取 content |
| `looksLikeChallengePage` | `challenge-detection.ts` | 反爬挑战页识别 |

## 5. 调用关系

```text
weatherAgent ──▶ weatherTool ─────────────────────────────▶ Open-Meteo

generalAgent ──┬──▶ webOpenUrl ─────▶ 目标网页
               │
               └──▶ webOpenUrlRendered ─────▶ Playwright Chromium
                            │
                            ▼
                  looksLikeChallengePage
```

## 6. C4 Code：Tool 定义模式

```typescript
export const weatherTool = createTool({
  id: 'get-weather',
  description: '获取指定地点的当前天气',
  inputSchema: z.object({ location: z.string().describe('City name') }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string(),
  }),
  execute: async (inputData) => {
    return await getWeather(inputData.location);
  },
});
```

## 7. 设计要点

- **失败即结构化返回**：工具执行失败不抛异常，而是返回 `{ ok: false, error }`，让模型决定如何向用户解释。
- **裸 fetch 优先**：`webOpenUrl` 更快、更轻量；只有遇到 JS/反爬才启用无头浏览器。
- **反爬识别落地判定**：不以 content-type 为准，而以最终 URL + HTML 内容判定是否仍被拦截。
