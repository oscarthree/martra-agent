# 技术架构（Technology Architecture）

> 4A 架构视角之一，对应 C4 模型的 **C3 Component** 与 **C4 Code**。
> 说明系统内部组件的技术实现、关键技术决策与代码级细节。

## C3 Component Diagram

```mermaid
C4Component
    title Component Diagram - Weather Copilot Backend
    Container_Boundary(express, "Express Server") {
        Component(middleware, "JSON Middleware", "express.json({ limit: \"20mb\" })", "解析大请求体")
        Component(server, "MastraServer", "@mastra/express", "挂载 Mastra 实例")
        Component(runtime, "CopilotRuntime", "@copilotkit/runtime/v2", "暴露本地 Agent")
        Component(handler, "CopilotExpressHandler", "@copilotkit/runtime/v2/express", "处理 /api/copilotkit")
    }

    Container_Boundary(mastra, "Mastra") {
        Component(mastraInstance, "Mastra", "@mastra/core", "注册 agents/workflows/storage")
        Component(compositeStore, "MastraCompositeStore", "@mastra/core/storage", "按 domain 路由存储")
        Component(observability, "Observability", "@mastra/observability", "Pino + Exporters + SensitiveDataFilter")
    }

    Container_Boundary(agents, "Agents") {
        Component(weatherAgent, "weatherAgent", "Agent", "天气查询 + 工作流路由")
        Component(generalAgent, "generalAgent", "Agent", "通用对话 + 图片 + 网页抓取")
        Component(activityPlannerAgent, "activityPlannerAgent", "Agent", "活动规划专家")
    }

    Container_Boundary(tools, "Tools") {
        Component(weatherTool, "weatherTool", "createTool", "Open-Meteo 当前天气")
        Component(webOpenUrl, "webOpenUrl", "createTool", "裸 fetch 网页抓取")
        Component(webOpenUrlRendered, "webOpenUrlRendered", "createTool", "Playwright 渲染抓取")
        Component(challengeDetection, "challenge-detection", "函数", "反爬挑战页识别")
    }

    Container_Boundary(processors, "Processors") {
        Component(toolResultTrimmer, "ToolResultTrimmer", "Processor", "历史 HTML 结果压缩")
    }

    Container_Boundary(workflows, "Workflows") {
        Component(fetchWeather, "fetchWeather", "createStep", "Open-Meteo 多日预报")
        Component(planActivities, "planActivities", "createStep", "调用 activityPlannerAgent")
    }

    Rel(middleware, server, "")
    Rel(server, mastraInstance, "await server.init()")
    Rel(handler, runtime, "createCopilotExpressHandler")
    Rel(runtime, mastraInstance, "getLocalAgents")
    Rel(mastraInstance, agents, "agents registry")
    Rel(mastraInstance, compositeStore, "storage")
    Rel(mastraInstance, observability, "observability")
    Rel(weatherAgent, weatherTool, "普通天气查询")
    Rel(weatherAgent, workflows, "行程/活动请求")
    Rel(generalAgent, webOpenUrl, "默认网页抓取")
    Rel(generalAgent, webOpenUrlRendered, "JS/反爬兜底")
    Rel(generalAgent, toolResultTrimmer, "inputProcessors")
    Rel(webOpenUrlRendered, challengeDetection, "落地后判定")
    Rel(workflows, fetchWeather, "then")
    Rel(workflows, planActivities, "then")
    Rel(planActivities, activityPlannerAgent, "stream")
```

## 1. 运行时平台

| 层级 | 技术 | 说明 |
| --- | --- | --- |
| 语言 / 模块系统 | TypeScript 5.9 + ESM | `package.json` 设置 `"type": "module"`；tsconfig 启用 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride` |
| 运行时 | Node.js 24+ | 后端服务直接由 `tsx` 运行 TS 源码 |
| 包管理 | pnpm 10+ | 使用 `pnpm-workspace.yaml` 与 `patchedDependencies` 管理补丁 |

## 2. 后端技术栈

### 2.1 Web 服务与 AI 运行时

| 组件 | 库 / 版本 | 职责 |
| --- | --- | --- |
| Web 框架 | Express 5 | 提供 HTTP 服务、中间件、路由 |
| Mastra 集成 | `@mastra/express` | 将 Mastra 实例挂载到 Express，提供 `MastraServer` |
| AI 框架 | `@mastra/core` | Agent、Tool、Workflow、Memory 的定义与编排 |
| CopilotKit Runtime v2 | `@copilotkit/runtime` | 前端聊天协议的服务端运行时 |
| AG-UI Mastra 适配器 | `@ag-ui/mastra` | 将 Mastra agents 暴露为 CopilotKit 可用的 `MastraAgent` |

### 2.2 模型接入

| 组件 | 库 / 配置 | 职责 |
| --- | --- | --- |
| Provider | `@ai-sdk/openai-compatible` | 兼容 OpenAI 接口协议 |
| 模型端点 | Moonshot (`api.moonshot.cn/v1`) | 由环境变量 `MOONSHOT_BASE_URL` / `MOONSHOT_API_KEY` 配置 |
| 实际模型 | `kimi-k2.7-code` | 硬编码于各 Agent 文件，具备视觉能力 |

### 2.3 记忆与外部能力

| 组件 | 库 / 实现 | 职责 |
| --- | --- | --- |
| 记忆 | `@mastra/memory` | 基于线程（thread）的对话上下文召回 |
| 记忆软化 | 自定义 `SessionMemory` | 将 "No thread found" 异常软化为空结果，避免新会话首条消息报错 |
| 无头浏览器 | Playwright 1.63+ | `webOpenUrlRenderedTool` 使用 headless Chromium 执行 JS、绕过反爬 |
| 天气数据 | Open-Meteo REST API | `weatherTool` 与 `weatherWorkflow` 调用 geocoding/forecast 接口 |

## 3. 前端技术栈

| 组件 | 库 / 版本 | 职责 |
| --- | --- | --- |
| 框架 | React 19 | 组件化 UI |
| 构建工具 | Vite 8 | 开发服务器、生产构建、`/api` 代理 |
| React 插件 | `@vitejs/plugin-react` | Fast Refresh、JSX 转换 |
| 聊天 SDK | `@copilotkit/react-core` / `react-ui` v2 | 受控 `CopilotChatView`、`useAgent`、`useAttachments` |
| 图标 | `lucide-react` | 工作区图标 |

## 4. C4 Code：关键代码结构

### 4.1 后端入口 `src/index.ts`

```typescript
const app = express();
app.use(express.json({ limit: "20mb" }));

const server = new MastraServer({ app, mastra });
await server.init();

const copilotRuntime = new CopilotRuntime({
  agents: ({ request }) =>
    MastraAgent.getLocalAgents({
      mastra,
      resourceId: request.headers.get("x-mastra-resource-id") || "default",
    }),
});

app.use(
  createCopilotExpressHandler({
    runtime: copilotRuntime,
    basePath: "/api/copilotkit",
    mode: "single-route",
  }),
);
```

要点：
- `20mb` JSON 限制：容纳 base64 图片与大段 HTML 工具结果。
- `resourceId` 从请求头读取，关联 Mastra Memory。

### 4.2 Agent 定义模式

```typescript
export const xxxAgent = new Agent({
  id: 'xxx-agent',
  instructions: `...`,
  model: kimi.chatModel('kimi-k2.7-code'),
  tools: { ... },
  workflows: { ... },
  memory: new SessionMemory(),
  inputProcessors: [new ToolResultTrimmer()], // generalAgent 专属
});
```

### 4.3 Tool 定义模式

```typescript
export const xxxTool = createTool({
  id: 'xxx',
  description: '...',
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
  execute: async (inputData) => { ... },
});
```

### 4.4 Workflow 定义模式

```typescript
const weatherWorkflow = createWorkflow({
  id: 'weather-workflow',
  inputSchema: weatherWorkflowInputSchema,
  outputSchema: z.object({ activities: z.string() }),
})
  .then(fetchWeather)
  .then(planActivities);

weatherWorkflow.commit();
```

## 5. 通信架构

```text
浏览器 (http://localhost:5173)
    │ CopilotKit v2 协议
    │ POST /api/copilotkit
    ▼
Vite 开发服务器 ──proxy──▶ Express (http://localhost:3000)
                                │
                                ▼
                        createCopilotExpressHandler
                                │
                                ▼
                    CopilotRuntime.getAgentsForRequest
                                │
                                ▼
                    MastraAgent.getLocalAgents({ mastra, resourceId })
                                │
                                ▼
                        weatherAgent / generalAgent
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            weatherTool /          webOpenUrl / webOpenUrlRendered
            weatherWorkflow                │
                    │                      ▼
                    ▼              Open-Meteo / 目标网页
            Open-Meteo
```

- **协议**：前端与后端通过 CopilotKit v2 的 HTTP/JSON 协议通信；请求头携带 `x-mastra-resource-id`。
- **代理**：开发阶段 Vite 将 `/api/*` 代理到 Express `localhost:3000`。
- **请求体大小**：Express JSON 中间件限制 `20mb`。

## 6. 存储与可观测性技术

| 数据类型 | 存储 | 说明 |
| --- | --- | --- |
| 应用持久化数据 | LibSQL (`mastra.db`) | 线程、消息、记忆、资源身份；部署时可切换 Turso |
| 可观测性数据 | DuckDB (`mastra.duckdb`) | span、trace、日志事件 |
| 统一抽象 | `MastraCompositeStore` | 按 domain 路由到不同底层存储 |
| 日志 | `PinoLogger` | 结构化日志 |
| 可观测性导出 | `MastraStorageExporter` + `MastraPlatformExporter` | 本地存储 + 可选 Mastra Platform 上报 |
| 数据脱敏 | `SensitiveDataFilter` | span 输出中过滤密码、token、key |

## 7. 部署形态

| 环境 | 启动命令 | 说明 |
| --- | --- | --- |
| 开发 | `pnpm start` + `pnpm client:dev` | 同时运行后端与前端开发服务器 |
| 生产构建 | `pnpm client:build` | 输出静态文件到 `dist/`，可由任意静态服务器托管 |
| 可选托管数据库 | 设置 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | `mastra.db` 切换为 Turso 托管 |
| 可选可观测性上报 | 设置 `MASTRA_PLATFORM_ACCESS_TOKEN` | 可观测性事件发送到 Mastra Platform |
| 浏览器依赖 | `pnpm exec playwright install chromium` | 首次运行时下载约 300MB Chromium 二进制 |

## 8. 关键技术决策

| 决策 | 原因 | 相关文件 |
| --- | --- | --- |
| 使用 CopilotKit v2 + AG-UI | 提供受控聊天视图，便于与工作区状态集成 | `src/client/main.tsx` |
| 自建 `webOpenUrl` 替代内置搜索 | 内置 `$web_search` 在 coding 端点不可用，且用户要求不引入第三方搜索 API | `docs/adr/0002-web-open-url-replaces-builtin-web-search.md` |
| 无头浏览器作为兜底 | 豆瓣等站点对裸 fetch 返回 JS 挑战页，Playwright 可执行 JS 种 Cookie 后跳回 | `docs/adr/0003-web-open-url-rendered-headless-browser.md` |
| `MastraCompositeStore` 组合 LibSQL + DuckDB | 应用数据与可观测性数据特征不同，分离存储更合理 | `src/mastra/index.ts` |
| 图片在 localStorage 中降级为占位符 | 避免 base64 图片撑爆 localStorage 配额 | `src/client/workspace-state.ts` |
