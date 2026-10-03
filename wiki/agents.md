# Agent 层

> C4 层级：**C3 Component**（Mastra 容器内负责 LLM 推理与意图路由的组件）。

## 1. 职责

Agent 层封装大模型能力，决定：

1. 如何理解用户输入。
2. 选择调用哪个 Tool 或 Workflow。
3. 管理会话记忆（`SessionMemory`）。
4. 生成最终回复。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/mastra/agents/index.ts` | Agent 注册表，导出 `{ weatherAgent, generalAgent, activityPlannerAgent }` |
| `src/mastra/agents/shared.ts` | 共享 Moonshot provider 与 `SessionMemory` |
| `src/mastra/agents/weather-agent.ts` | 天气主 Agent |
| `src/mastra/agents/general-agent.ts` | 通用助手 Agent |
| `src/mastra/agents/activity-planner-agent.ts` | 活动规划 Agent（工作流内部使用） |

## 3. Agent 一览

### 3.1 weatherAgent

| 属性 | 值 |
| --- | --- |
| id | `weather-agent` |
| 注册键 | `weatherAgent`（`runtimeAgentIdFor("weather")`） |
| 工具 | `weatherTool` |
| 工作流 | `weatherWorkflow` |
| 记忆 | `SessionMemory` |
| 模型 | `kimi.chatModel('kimi-k2.7-code')` |

职责：
- 普通天气查询 → 调用 `weatherTool`。
- 活动/行程/旅游/攻略/计划类请求 → 调用 `weatherWorkflow`，提取 `{ city, days }`。
- 必须原样保留 `weatherWorkflow` 返回的活动正文格式。

### 3.2 generalAgent

| 属性 | 值 |
| --- | --- |
| id | `general-agent` |
| 注册键 | `generalAgent`（`runtimeAgentIdFor("general")`） |
| 工具 | `webOpenUrl`、`webOpenUrlRendered` |
| 工作流 | 无 |
| 记忆 | `SessionMemory` |
| 输入处理器 | `ToolResultTrimmer` |

职责：
- 日常对话、闲聊、写作、翻译。
- 图片理解（多模态输入）。
- 用户给出具体 URL 时抓取网页；失败时按策略降级到无头浏览器。
- 没有主动搜索能力，禁止假装检索。

### 3.3 activityPlannerAgent

| 属性 | 值 |
| --- | --- |
| id | `activity-planner-agent` |
| 注册键 | `activityPlannerAgent` |
| 工具 | 无 |
| 工作流 | 无 |
| 记忆 | 无（独立 Agent） |

职责：
- 被 `weatherWorkflow` 的 `planActivities` 步骤调用。
- 严格按照模板输出活动规划，保留章节标题与表情符号。

## 4. 关键类 / 函数

| 名称 | 来源 | 作用 |
| --- | --- | --- |
| `Agent` | `@mastra/core/agent` | Agent 基类 |
| `createOpenAICompatible` | `@ai-sdk/openai-compatible` | 创建 Moonshot 兼容 provider |
| `kimi` | `shared.ts` | 共享 provider，统一 baseURL/apiKey |
| `SessionMemory` | `shared.ts` | 继承 `@mastra/memory`，软化 "No thread found" 异常 |
| `runtimeAgentIdFor` | `src/client/workspace-state.ts` | 将 `AgentType` 映射到注册键 |

## 5. 调用关系

```text
CopilotKit Runtime
    │
    ▼
weatherAgent ─────────────┬───▶ weatherTool ─────▶ Open-Meteo
                          │
                          └───▶ weatherWorkflow
                                  ├── fetchWeather ──▶ Open-Meteo
                                  └── planActivities ──▶ activityPlannerAgent ──▶ Moonshot

CopilotKit Runtime
    │
    ▼
generalAgent ─────────────┬───▶ webOpenUrl ─────▶ 目标网页
                          │
                          └───▶ webOpenUrlRendered ─────▶ Playwright
```

## 6. C4 Code：SessionMemory

```typescript
import { Memory } from '@mastra/memory';

export class SessionMemory extends Memory {
  override async recall(args) {
    try {
      return await super.recall(args);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No thread found")) {
        return { messages: [], total: 0, page: 0, perPage: false, hasMore: false };
      }
      throw error;
    }
  }
}
```

设计要点：新线程在存储中尚无记录时，`@mastra/memory` 会抛异常。此处将其软化为空结果，避免 AG-UI 适配器在新会话首条消息时告警。
