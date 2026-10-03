# 应用架构（Application Architecture）

> 4A 架构视角之一，对应 C4 模型的 **C2 Container**。
> 描述 Weather Copilot 内部的主要应用/容器、职责及相互关系。

## C2 Container Diagram

```mermaid
C4Container
    title Container Diagram - Weather Copilot
    Person(user, "终端用户", "浏览器端用户")

    Container_Boundary(browser, "浏览器") {
        Container(spa, "React SPA", "React 19 + Vite", "工作区 UI、受控聊天、本地状态持久化")
    }

    Container_Boundary(backend, "后端服务") {
        Container(express, "Express Server", "Express 5 + TypeScript", "HTTP 服务、CopilotKit Runtime 挂载")
        Container(copilotRuntime, "CopilotKit Runtime v2", "@copilotkit/runtime", "聊天协议适配、Agent 调度")
        Container(mastra, "Mastra", "@mastra/core", "Agent / Tool / Workflow / Memory 编排")
        Container(agents, "Agents", "weather / general / activity-planner", "LLM 能力封装与意图路由")
        Container(tools, "Tools", "weather / web-open-url / web-open-url-rendered", "外部数据获取与网页抓取")
        Container(workflow, "Workflow", "weather-workflow", "fetch-weather → plan-activities 两步编排")
    }

    ContainerDb(libsql, "应用数据库", "LibSQL / Turso", "线程、消息、记忆、资源身份")
    ContainerDb(duckdb, "可观测性数据库", "DuckDB", "span、trace、日志事件")
    Container_Ext(openMeteo, "Open-Meteo", "天气预报 API")
    Container_Ext(moonshot, "Moonshot", "Kimi 大模型 API")
    Container_Ext(playwright, "Playwright", "headless Chromium", "JS 动态与反爬站点抓取")

    Rel(user, spa, "使用工作区与聊天")
    Rel(spa, express, "POST /api/copilotkit", "CopilotKit v2 协议")
    Rel(express, copilotRuntime, "createCopilotExpressHandler")
    Rel(copilotRuntime, mastra, "MastraAgent.getLocalAgents")
    Rel(mastra, agents, "调度 Agent")
    Rel(agents, tools, "调用工具")
    Rel(agents, workflow, "触发工作流")
    Rel(workflow, tools, "fetch-weather")
    Rel(workflow, agents, "plan-activities 调用 activityPlannerAgent")
    Rel(mastra, libsql, "读写线程与记忆")
    Rel(mastra, duckdb, "写入可观测性数据")
    Rel(tools, openMeteo, "REST API")
    Rel(agents, moonshot, "LLM 请求")
    Rel(tools, playwright, "渲染抓取")
```

## 1. 容器清单

| 容器 | 技术 | 职责 | 关键源码 |
| --- | --- | --- | --- |
| React SPA | React 19 + Vite | 工作区 UI、会话管理、受控 CopilotChatView、localStorage 持久化 | `src/client/` |
| Express Server | Express 5 + tsx | HTTP 入口、JSON 解析、CopilotKit Runtime 挂载 | `src/index.ts` |
| CopilotKit Runtime v2 | `@copilotkit/runtime` | 将前端聊天请求路由到后端 Agent | `src/index.ts` |
| Mastra | `@mastra/core` | Agent、Tool、Workflow、Memory 的注册与编排 | `src/mastra/index.ts` |
| Agents | `@mastra/core/agent` | 三个 Agent 的指令、工具、记忆配置 | `src/mastra/agents/` |
| Tools | `@mastra/core/tools` | 外部 API 调用与网页抓取 | `src/mastra/tools/` |
| Workflow | `@mastra/core/workflows` | 天气获取 + 活动规划的两步工作流 | `src/mastra/workflows/` |

## 2. 数据存储容器

| 存储 | 技术 | 数据 | 说明 |
| --- | --- | --- | --- |
| 应用数据库 | LibSQL（本地 `mastra.db`，可选 Turso） | 线程、消息、记忆、资源身份 | `MastraCompositeStore` 的 default 域 |
| 可观测性数据库 | DuckDB（本地 `mastra.duckdb`） | span、trace、日志事件 | `MastraCompositeStore` 的 observability 域 |
| 浏览器本地存储 | localStorage | `WorkspaceState`、`mastra-resource-id` | 前端状态快照 |

## 3. 外部服务容器

| 外部服务 | 作用 | 集成方式 |
| --- | --- | --- |
| Moonshot | LLM 推理 | `@ai-sdk/openai-compatible` → `kimi.chatModel('kimi-k2.7-code')` |
| Open-Meteo | 地理编码与天气预报 | 裸 `fetch` + 指数退避 |
| Playwright | 无头浏览器渲染 | `playwright.chromium.launch` + 进程级复用 |

## 4. 容器间交互

### 4.1 前端 ↔ 后端

- 协议：CopilotKit v2 HTTP/JSON。
- 地址：开发时 Vite 代理 `/api` 到 Express `localhost:3000`。
- 关键头：`x-mastra-resource-id` 用于关联后端 Mastra Memory。

### 4.2 后端内部

```text
Express
  └── createCopilotExpressHandler
        └── CopilotRuntime
              └── MastraAgent.getLocalAgents({ mastra, resourceId })
                    ├── weatherAgent
                    │     ├── weatherTool
                    │     └── weatherWorkflow
                    │           ├── fetchWeather (Open-Meteo)
                    │           └── planActivities (activityPlannerAgent)
                    └── generalAgent
                          ├── webOpenUrl
                          └── webOpenUrlRendered (Playwright)
```

### 4.3 后端 ↔ 存储

- Mastra 通过 `MastraCompositeStore` 统一访问：
  - 应用数据 → LibSQLStore
  - 可观测性数据 → DuckDBStore

## 5. 部署视图

```text
┌─────────────────┐
│   浏览器用户     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  React SPA      │────▶│  Vite dev server│ (dev only)
│  (dist/ 生产)    │     │  /api → proxy   │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Express Server  │
                        │ :3000           │
                        └────────┬────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │  mastra.db    │   │mastra.duckdb  │   │  Moonshot     │
    │  (LibSQL)     │   │  (DuckDB)     │   │  OpenAI 兼容  │
    └───────────────┘   └───────────────┘   └───────────────┘
            │
            ▼
    ┌───────────────┐
    │  Open-Meteo   │
    └───────────────┘
```

## 6. 模块边界与职责

| 边界 | 职责 | 不承担的职责 |
| --- | --- | --- |
| 前端 | 工作区管理、聊天视图、本地快照 | 不直接调用 LLM 或外部天气 API |
| Express 入口 | HTTP 服务、协议适配 | 不包含业务逻辑 |
| CopilotKit Runtime | Agent 发现与请求分发 | 不处理工具实现 |
| Mastra | 组件注册、存储与记忆抽象 | 不处理 UI 或协议细节 |
| Agents | 意图理解、工具选择、回复生成 | 不直接访问网络 |
| Tools | 外部数据获取、网页抓取 | 不做 LLM 推理 |
| Workflow | 多步骤天气+活动编排 | 不处理单步细节 |
