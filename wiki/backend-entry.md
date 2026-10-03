# 后端入口（Backend Entry）

> C4 层级：**C3 Component**（`src/index.ts` 是 Express 容器内的核心组件）。

## 1. 职责

`src/index.ts` 是 Weather Copilot 的后端入口，负责：

1. 创建并配置 Express 应用。
2. 初始化 `MastraServer`，将 Mastra 实例挂载到 Express。
3. 配置 `CopilotRuntime` v2，暴露 Mastra 本地 Agent。
4. 通过 `createCopilotExpressHandler` 将 `/api/copilotkit` 路由接入 CopilotKit 协议。
5. 启动 HTTP 服务监听 `PORT`（默认 3000）。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/index.ts` | Express 入口与 CopilotKit Runtime 装配 |
| `src/mastra/index.ts` | 被 `server.init()` 使用的 Mastra 实例 |

## 3. 关键类 / 函数

| 名称 | 来源 | 作用 |
| --- | --- | --- |
| `express()` | `express` | 创建 Express 应用 |
| `express.json({ limit: "20mb" })` | `express` | 解析 JSON 请求体，放宽限制以容纳大段 HTML/base64 图片 |
| `MastraServer` | `@mastra/express` | 将 Mastra 实例集成到 Express |
| `CopilotRuntime` | `@copilotkit/runtime/v2` | CopilotKit 运行时，管理 Agent 生命周期 |
| `createCopilotExpressHandler` | `@copilotkit/runtime/v2/express` | 生成处理 CopilotKit 请求的中间件 |
| `MastraAgent.getLocalAgents` | `@ag-ui/mastra` | 从 Mastra 实例获取可被 CopilotKit 使用的本地 Agent 列表 |

## 4. 调用关系

```text
浏览器 POST /api/copilotkit
    │
    ▼
Express app
    │
    ▼
createCopilotExpressHandler
    │
    ▼
CopilotRuntime
    │
    ▼
MastraAgent.getLocalAgents({ mastra, resourceId })
    │
    ├──────▶ weatherAgent
    │          ├── weatherTool
    │          └── weatherWorkflow
    │
    └──────▶ generalAgent
               ├── webOpenUrl
               └── webOpenUrlRendered
```

## 5. C4 Code 关键代码

```typescript
import 'dotenv/config';
import express from "express";
import { MastraServer } from "@mastra/express";
import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
import { mastra } from "./mastra";

const app = express();
const PORT = process.env.PORT || 3000;

// 20mb 限制：CopilotKit 每轮携带完整消息历史（含图片、HTML）
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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
```

## 6. 设计要点

- **`resourceId` 提取**：从请求头 `x-mastra-resource-id` 读取，缺省 `"default"`，用于区分不同浏览器用户的 Mastra Memory。
- **`mode: "single-route"`**：CopilotKit v2 单路由模式，所有聊天相关请求走 `/api/copilotkit`。
- **Top-level await**：ESM 支持顶层 `await server.init()`。
