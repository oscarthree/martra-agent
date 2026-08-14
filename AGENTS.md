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

模型能力由 Moonshot 的 OpenAI 兼容接口提供（当前固定使用 `kimi-k2.7-code`）。前端是 React 19 + CopilotKit Chat，后端通过 Mastra 管理 Agent、Tool、Workflow、Memory 和存储。

### 运行时架构

```text
CopilotChat (React, Vite :5173)
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
- **前端**：React 19 + Vite + `@copilotkit/react-core` / `react-ui`（v2 API）
- **存储**：LibSQL（本地文件 `mastra.db`，部署时可切换 Turso）保存应用数据，DuckDB（`mastra.duckdb`）保存可观测性数据
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
- `OPENAI_API_KEY` / `OPENAI_BASE_URL`：可选的备用 key 名称
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`：可选，设置后 Mastra 存储切换到托管 Turso 数据库（见 `src/mastra/index.ts`）
- `MASTRA_PLATFORM_ACCESS_TOKEN`：可选，设置后可观测性事件会发送到 Mastra Platform

## 代码结构

```text
src/
├── index.ts                         # Express 服务入口：MastraServer、CopilotKit Runtime v2、/api/copilotkit 路由
├── client/
│   ├── main.tsx                     # CopilotKit Chat 入口（React 19，CopilotKit v2 API）
│   ├── styles.css                   # 前端样式
│   ├── workspace-state.ts           # 工作区/项目/会话的本地状态模型（localStorage 持久化）
│   └── workspace-state.test.ts      # 工作区状态测试
└── mastra/
    ├── index.ts                     # Mastra 实例：注册全部 agent/workflow，配置存储、日志、可观测性
    ├── agents/
    │   ├── weather-agent.ts         # 天气主 Agent，负责意图路由（工具 vs 工作流）
    │   └── activity-planner-agent.ts # 活动规划 Agent，被工作流调用
    ├── tools/
    │   └── weather-tool.ts          # 当前天气工具（Open-Meteo）
    └── workflows/
        ├── weather-workflow.ts      # fetch-weather -> plan-activities 两步工作流
        └── weather-workflow.test.ts # 工作流输入 schema 校验测试
```

其他目录：

- `CONTEXT.md`：领域模型词汇表（Workspace / Project / Session / Resource Identity 等），修改工作区相关代码时应与其保持一致
- `prototype/`、`wayfinder/`、`.scratch/`：原型和草稿目录，不属于主应用构建
- `patches/` + `pnpm-workspace.yaml`：通过 pnpm `patchedDependencies` 给 `fast-json-patch@3.1.1` 打补丁
- 根目录 `index.html` 是 Vite 入口，`vite.config.ts` 只配置了 React 插件和 `/api` 代理

## 代码风格约定

- TypeScript `strict` 模式，外加 `noUncheckedIndexedAccess`、`noImplicitOverride`、`verbatimModuleSyntax`；数组取值要注意 undefined 检查（参考工作流里的 `requiredAt` 辅助函数）
- 全项目 ESM；`type` 导入使用 `import type`
- Agent 指令、zod `describe`、用户可见文案使用中文；代码标识符和日志使用英文
- Mastra 组件用 `createStep` / `createWorkflow` / `new Agent` 定义，输入输出一律用 zod schema 描述，最后必须 `workflow.commit()`
- 外部 HTTP 请求使用带指数退避的 `withRetry` 模式（见 `weather-workflow.ts`）
- 新增 agent/tool/workflow/scorer 时，必须同时在 `src/mastra/index.ts` 注册

## 测试

- 使用 Vitest，运行 `pnpm test`
- 测试文件与源码同目录，命名为 `*.test.ts`
- 现有测试覆盖 zod schema 校验（工作流输入）和纯状态逻辑（workspace-state 的序列化/恢复）；网络与模型调用不做集成测试
- 提交前建议运行 `pnpm test` 和 `pnpm exec tsc --noEmit`

## 数据与运行时文件

运行服务后会在仓库根目录生成本地数据文件：`mastra.db`、`mastra.db-shm`、`mastra.db-wal`、`mastra.duckdb`、`mastra.duckdb.wal`。这些是运行时数据，不要提交到版本库。

浏览器端通过 `localStorage` 持久化 `mastra-resource-id`，后端从请求头 `x-mastra-resource-id` 读取（缺省为 `"default"`），用于关联 Mastra Memory 的服务端记忆（即 CONTEXT.md 中的 Resource Identity）。

## 安全注意事项

- `.env` 已在 `.gitignore` 中，**绝不要提交 API Key**；`.env.example` 只保留占位符
- 可观测性管道配置了 `SensitiveDataFilter`，用于脱敏 span 输出中的密码、token、key，新增 exporter 时保留该 processor
- 天气数据来自外部 API（Open-Meteo），注意网络失败路径；所有外部请求都应走重试逻辑
- 模型生成的活动建议仅供参考，不要在 UI 或文档中将其表述为专业天气预警或旅行安全建议

## 部署

仓库中没有 CI/CD 配置或部署脚本。当前唯一的部署相关路径是：设置 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` 使用托管数据库（`src/mastra/index.ts` 注释提到 `mastra env db create --kind turso`），以及设置 `MASTRA_PLATFORM_ACCESS_TOKEN` 上报可观测性数据到 Mastra Platform。前端通过 `pnpm client:build` 产出静态文件到 `dist/`。
