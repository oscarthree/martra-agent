# 0001 — 通用助手联网搜索走 coding 端点的 `$web_search` 内置工具

> **已被 [ADR 0002](./0002-web-open-url-replaces-builtin-web-search.md) 取代**：`$web_search` 多轮对话实测不可用，联网能力改为自建 `web_open_url` 抓取工具。

通用助手（generalAgent）需要联网能力。本仓库的 Moonshot key 属于 Kimi Coding 计划（`api.kimi.com/coding`），实测（2026-08-25，探针脚本在 `.scratch/probe-web-search-*.ts`）：官方推荐的 Formula API `moonshot/web-search:latest` 在该端点不存在（404），该 key 在 platform 站点（api.moonshot.cn / api.moonshot.ai）无效（401）；而内置工具 `$web_search`（`builtin_function` + arguments echo 回传）在 coding 端点完整可用。因此联网搜索通过 `$web_search` 实现：provider 的 `transformRequestBody` 把同名工具声明改写为 `builtin_function`，Mastra 侧注册同名 echo 工具（execute 原样返回入参）承接服务端 tool_call。

## Considered Options

- **Moonshot Formula `moonshot/web-search:latest`**：官方论坛推荐的新路径，普通 tool-call 契约，但当前账号端点不支持（实测 404/401）。
- **第三方搜索 API（Tavily 等）**：确定性最高，但用户明确要求不引入第三方依赖。
- **自建简易爬虫**：约定为 `$web_search` 不可用时的回退方向，本轮不实施。

## Consequences

- Moonshot 官方称 `$web_search` 正在改版、近期不建议新用；若未来在 coding 端点失效，回退方向是自建简易爬虫（见上），工具接口（`web_search(query)`）保持不变。
- 搜索结果规模由服务端托管，不可控；回答指令要求附来源链接。
- `fetchWebPageTool`（抓指定 URL 正文）有意延后，本轮只做搜索。
- coding 计划下搜索是否单独计费未在文档中明确，按订阅包含处理，后续留意账单。
