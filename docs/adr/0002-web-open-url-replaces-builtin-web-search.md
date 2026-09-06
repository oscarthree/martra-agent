# 0002 — 自建 `web_open_url` 网页抓取工具，取代 `$web_search` 内置工具

ADR 0001 选择的 `$web_search`（Kimi coding 端点内置联网搜索）在多轮对话实测中无法跑通，决定放弃，删除其全部兼容层（`transformRequestBody` 改写、echo 工具、非流式首轮包装）。改为自建的网页抓取工具 `web_open_url`（`src/mastra/tools/web-open-url-tool.ts`），挂在 generalAgent 上。

## 工具契约

用户提供具体网址 → agent 调用 `web_open_url` → 服务端请求该网页 → 返回原始 HTML 内容。

特性：

- 直接获取页面的原始 HTML（超长截断至 50,000 字符）
- 支持跟随重定向（3xx）
- 超时保护（15 秒），5xx 指数退避重试
- 只能读取公开可访问的网页（不需要登录、没有反爬虫拦截的）

限制：

- 无法执行 JavaScript（看不到 JS 渲染的动态内容）
- 无法绕过登录/验证码/CAPTCHA
- 无法下载文件（PDF、图片、视频等）
- 部分网站会拦截非浏览器请求（返回 403/验证页面）

## Considered Options

- **继续修 `$web_search`**：多轮实测不可用，且依赖服务端未公开的行为（search_id 续轮解析），脆弱性已在 ADR 0001 的兼容层复杂度中体现，放弃。
- **第三方搜索 API（Tavily 等）**：确定性最高，但用户明确要求不引入第三方依赖。
- **自建 `web_open_url`**（采纳）：行为完全可控、可测试，代价是只能打开给定 URL，不能主动搜索。

## Consequences

- generalAgent 失去主动联网搜索能力，只能抓取用户给出的具体 URL；agent 指令需如实说明这一点，禁止假装检索。
- 失败以结构化结果（`{ ok: false, error }`）返回给模型而不是抛异常，模型可如实向用户解释 403/超时/非 HTML 等情况。
- 抓取工具返回原始 HTML 而非提取正文，上下文占用由 50,000 字符截断兜底。
- `$web_search` 相关探针脚本保留在 `.scratch/` 供追溯。
