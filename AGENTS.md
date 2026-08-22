# AGENTS.md

## 关键规则：先加载 `mastra` skill

在进行任何 Mastra 相关开发**之前**，必须先加载 `mastra` skill。不要依赖缓存的知识——Mastra 的 API 在不同版本之间会发生变化。

- 所有 agent、tool、workflow、scorer 都必须注册到 `src/mastra/index.ts`
- 使用 `package.json` 中的脚本，不要直接运行 `mastra dev` / `mastra build`

参考资源：

- [Mastra 文档](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)

## 项目概述

仓库名为 `express-ts-boilerplate`，实际应用是 **Weather Copilot**（天气助手）：一个基于 Express、Mastra、AG-UI 和 CopilotKit 的天气助手示例。用户可以查询指定城市的当前天气，也可以根据未来 1 到 7 天的天气预报生成活动和旅行计划。

模型能力由 Moonshot 的 OpenAI 兼容接口提供（模型名硬编码为 `kimi-k2.7-code`，见 `src/mastra/agents/`）。前端是 React 19 + CopilotKit Chat（v2 API），后端通过 Mastra 管理 Agent、Tool、Workflow、Memory 和存储。

前端在工作区（Workspace）模型上组织聊天：项目（Project）包含多个会话（Session），每个会话对应一个 Mastra 线程（`threadId = session.id`）。领域术语定义见 `CONTEXT.md`。

### 运行时架构

```text
CopilotChatView (React, Vite :5173)
    |
    | /api/copilotkit （Vite 开发服务器代理到 :3000）
    v
CopilotKit Runtime v2 (Express :3000)
    |
    v
AG-UI Mastra Adapter (@ag-ui/mastra)
    |
    v
weatherAgent
    |-- 普通当前天气查询 -> weatherTool -> Open-Meteo
    |
    `-- 活动/行程请求 -> weatherWorkflow
                            |-- 地理编码和多日天气预报 -> Open-Meteo
                            `-- activityPlannerAgent -> 模板化活动规划
```

意图识别由 `weatherAgent` 根据指令自行选择工具：普通当前天气查询走 `weatherTool`，活动/行程/旅游/攻略/计划类请求走 `weatherWorkflow`（输入为 `{ city: string; days: number }`，days 为 1 到 7，默认 1）。

## 技术栈

- **运行时**：Node.js 24 或更高版本；包管理器 pnpm 10 或更高版本
- **后端**：Express 5 + TypeScript（ESM，`"type": "module"`），通过 `tsx` 直接运行 TS
- **AI 框架**：Mastra（`@mastra/core`、`@mastra/express`、`@mastra/memory` 等），模型通过 `@ai-sdk/openai-compatible` 连接 Moonshot
- **前端**：React 19 + Vite + `@copilotkit/react-core` / `react-ui`（v2 API，`@copilotkit/react-core/v2`），图标使用 `lucide-react`
- **存储**：LibSQL（本地文件 `mastra.db`，部署时可切换 Turso）保存应用数据，DuckDB（`mastra.duckdb`）保存可观测性数据，二者经 `MastraCompositeStore` 组合
- **校验**：zod v4
- **测试**：Vitest

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装项目依赖 |
| `pnpm start` | 启动 Express + Mastra + CopilotKit 后端（默认 `http://localhost:3000`） |
| `pnpm client:dev` | 启动 Vite 前端开发服务器（默认 `http://localhost:5173`，`/api` 代理到 :3000） |
| `pnpm client:build` | 构建前端生产版本（输出到 `dist/`） |
| `pnpm test` | 运行 Vitest 测试（`vitest run`） |
| `pnpm exec tsc --noEmit` | TypeScript 类型检查（无单独 lint 配置） |

开发时需要同时运行 `pnpm start` 和 `pnpm client:dev` 两个进程。

## 环境变量

复制 `.env.example` 为 `.env` 后填写：

- `PORT`：后端端口，默认 `3000`
- `MOONSHOT_API_KEY`：**必填**，否则模型请求无法执行
- `MOONSHOT_BASE_URL`：默认 `https://api.moonshot.cn/v1`
- `COPILOTKIT_MODEL`：仅出现在 `.env.example` 中的参考值；代码未读取，实际模型名硬编码在 agent 文件里
- `OPENAI_API_KEY` / `OPENAI_BASE_URL`：可选的备用 key 名称（当前代码未使用）
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`：可选，设置后 Mastra 存储切换到托管 Turso 数据库（见 `src/mastra/index.ts`）
- `MASTRA_PLATFORM_ACCESS_TOKEN`：可选，设置后可观测性事件会发送到 Mastra Platform

## 代码结构

```text
src/
├── index.ts                         # Express 服务入口：MastraServer、CopilotKit Runtime v2、/api/copilotkit 路由
├── client/
│   ├── main.tsx                     # 工作区应用入口：Workspace 状态接线、受控 CopilotChatView、对话框调度
│   ├── workspace-ui.tsx             # 工作区展示组件：侧栏、Project Context Selector、抽屉、弹窗
│   ├── styles.css                   # 前端样式（浅色主题，--wc-* 变量避免与 CopilotKit 主题冲突）
│   ├── workspace-state.ts           # 工作区/项目/会话的本地状态模型（localStorage 持久化）
│   └── workspace-state.test.ts      # 工作区状态测试
└── mastra/
    ├── index.ts                     # Mastra 实例：注册全部 agent/workflow，配置存储、日志、可观测性
    ├── agents/
    │   ├── index.ts                   # agents 注册表（runtimeAgentId 键：weatherAgent / generalAgent）
    │   ├── shared.ts                  # 共享 Moonshot provider 与 SessionMemory（recall 软化覆写）
    │   ├── weather-agent.ts           # 天气主 Agent，负责意图路由（工具 vs 工作流）
    │   ├── general-agent.ts           # 通用助手 Agent，纯对话、支持图片理解，无工具
    │   ├── general-agent.test.ts      # generalAgent 定义形态与注册键测试
    │   └── activity-planner-agent.ts # 活动规划 Agent，被工作流调用
    ├── tools/
    │   └── weather-tool.ts          # 当前天气工具（Open-Meteo）
    └── workflows/
        ├── weather-workflow.ts      # fetch-weather -> plan-activities 两步工作流
        └── weather-workflow.test.ts # 工作流输入 schema 校验测试
```

其他目录与文件：

- `CONTEXT.md`：领域模型词汇表（Workspace / Project / Session / Resource Identity 等），修改工作区相关代码时应与其保持一致
- `prototype/`、`wayfinder/`、`.scratch/`：原型和草稿目录，不属于主应用构建
- `patches/` + `pnpm-workspace.yaml`：通过 pnpm `patchedDependencies` 给 `fast-json-patch@3.1.1` 打补丁
- 根目录 `index.html` 是 Vite 入口，`vite.config.ts` 只配置了 React 插件和 `/api` 代理
- `CLAUDE.md` 仅包含 `@AGENTS.md` 引用，以本文件为准

## 代码风格约定

- TypeScript `strict` 模式，外加 `noUncheckedIndexedAccess`、`noImplicitOverride`、`verbatimModuleSyntax`；数组取值要注意 undefined 检查（参考工作流里的 `requiredAt` 辅助函数）
- 全项目 ESM；`type` 导入使用 `import type`
- Agent 指令、zod `describe`、用户可见文案使用中文；代码标识符和日志使用英文
- Mastra 组件用 `createStep` / `createWorkflow` / `new Agent` 定义，输入输出一律用 zod schema 描述，最后必须 `workflow.commit()`
- 外部 HTTP 请求使用带指数退避的 `withRetry` 模式（见 `weather-workflow.ts`）
- 新增 agent/tool/workflow/scorer 时，必须同时在 `src/mastra/index.ts` 注册
- `agents/shared.ts` 中的 `SessionMemory` 覆写了 `Memory.recall()`：新会话线程在存储中尚无记录时 recall 会抛 "No thread found"，此处将其软化为空结果；修改 Memory 相关代码时不要移除该保护

## 工作区前端要点

- 工作区状态是纯函数模型（`workspace-state.ts`），通过 `localStorage` 键 `weather-copilot-workspace-v1` 持久化；加载失败会重置为默认工作区并提示
- 每个会话在 `useAgent` 中以 `agentId: workspace-session-<session.id>`、`threadId: session.id` 运行；首次进入会话时必须以本地快照覆盖 agent 消息（`hydratedSessions` 逻辑），之后用 `reconcileSessionMessages` 决定同步方向
- 浏览器端通过 `localStorage` 持久化 `mastra-resource-id`，请求时放入 `x-mastra-resource-id` 头，后端从该头读取（缺省为 `"default"`），用于关联 Mastra Memory 的服务端记忆（即 CONTEXT.md 中的 Resource Identity）

## 测试

- 使用 Vitest，运行 `pnpm test`
- 测试文件与源码同目录，命名为 `*.test.ts`（当前 3 个测试文件、64 个用例）
- 现有测试覆盖 zod schema 校验（工作流输入）和纯状态逻辑（workspace-state 的序列化/恢复/分组）；网络与模型调用不做集成测试
- 提交前建议运行 `pnpm test` 和 `pnpm exec tsc --noEmit`

## 数据与运行时文件

运行服务后会在仓库根目录生成本地数据文件：`mastra.db`、`mastra.db-shm`、`mastra.db-wal`、`mastra.duckdb`、`mastra.duckdb.wal`。这些是运行时数据，不要提交到版本库。

## 安全注意事项

- `.env` 已在 `.gitignore` 中，**绝不要提交 API Key**；`.env.example` 只保留占位符
- 可观测性管道配置了 `SensitiveDataFilter`，用于脱敏 span 输出中的密码、token、key，新增 exporter 时保留该 processor
- 天气数据来自外部 API（Open-Meteo），注意网络失败路径；所有外部请求都应走重试逻辑
- 模型生成的活动建议仅供参考，不要在 UI 或文档中将其表述为专业天气预警或旅行安全建议

## 部署

仓库中没有 CI/CD 配置或部署脚本。当前唯一的部署相关路径是：设置 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` 使用托管数据库（`src/mastra/index.ts` 注释提到 `mastra env db create --kind turso`），以及设置 `MASTRA_PLATFORM_ACCESS_TOKEN` 上报可观测性数据到 Mastra Platform。前端通过 `pnpm client:build` 产出静态文件到 `dist/`。
