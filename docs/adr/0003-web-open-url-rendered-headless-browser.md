# 0003 — 新增 `web_open_url_rendered`：无头浏览器渲染抓取，覆盖反爬/JS 动态站点

ADR 0002 的 `webOpenUrl`（裸 fetch）实测无法抓取豆瓣电影页：豆瓣对无浏览器特征的请求返回 302 到 `sec.douban.com` 安全校验页，需执行 JS 种 Cookie 后跳回才给真实内容（同 Cloudflare "Checking your browser" 一类）。为覆盖这类站点，新增 `webOpenUrlRendered` 工具（`src/mastra/tools/web-open-url-rendered-tool.ts`）：用 Playwright headless Chromium 打开页面、执行 JS、等待 networkidle 让挑战页跳回，返回渲染后的 HTML。

## Considered Options

- **只做反爬识别、明确报错（原选项 A）**：成本最低，但用户明确要求支持豆瓣类站点。
- **无头浏览器（采纳）**：Playwright + headless Chromium，行为可控、不依赖第三方服务。代价是 ~300MB 浏览器二进制、每次抓取数秒的延迟。
- **第三方抓取 API（ScrapingBee 等）**：用户明确要求不引入第三方依赖，排除。

## 实现要点

- 浏览器实例进程级懒加载复用；每次请求开独立 `BrowserContext`（隔离 Cookie/会话），`finally` 中关闭。
- `goto(waitUntil: 'domcontentloaded', timeout: 30s)` 后再等 `networkidle`（10s 上限，超时忽略），让 `sec.douban.com` 挑战页完成种 Cookie 跳回。
- networkidle 时序不可靠（可能在挑战 JS 跳回前就触发），落地后必须用 `challenge-detection.ts` 的 `looksLikeChallengePage` 判定：仍停在挑战页则等自动跳回 / 带已种 Cookie 手动重进目标页（最多 2 次），最终仍未通过则返回 `ok: false` 明确报"反爬校验未通过"，而不是把挑战页 HTML 当成功结果交给模型。
- `page.content()` 在页面导航中会抛错，由 `readContentWhenStable` 等导航落地重试（挑战页跳回常撞在此时间窗）。
- 输出 schema 与 `webOpenUrl` 同构（`ok` 判别联合、`finalUrl`、50,000 字符截断），另加 `title` 帮助模型判断抓到的内容。
- generalAgent 指令：默认 `webOpenUrl`；失败原因为 JS 动态渲染或反爬拦截时改用 `webOpenUrlRendered`；两者都失败则如实告知。
- `webOpenUrl`（裸 fetch）一侧：响应缺 `content-type` 不再误报"未知内容类型"，先读 body 再按挑战页特征判断，命中时返回"反爬安全验证页，请改用 webOpenUrlRendered"的明确指引。

## Consequences

- 新增运行时依赖 `playwright`；首次部署需执行 `pnpm exec playwright install chromium` 下载浏览器二进制。
- 不绕登录/验证码；部分站点能识别无头浏览器特征，仍可能拦截——工具的失败路径照旧返回结构化错误。
- 渲染抓取较慢（秒级），不套用 `withRetry` 指数退避（与 ADR 0002 工具不同）：聊天场景下 30s×3 的重试不可接受，失败直接返回由模型决定下一步。
- 绕过反爬挑战有目标站点服务条款风险，仅在用户显式给出 URL 时触发，不做批量抓取。
