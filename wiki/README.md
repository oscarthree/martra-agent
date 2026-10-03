# Weather Copilot Wiki

本目录按 **C4 模型** 与 **4A 企业架构** 组织文档：

- **C1 系统上下文** → 业务架构
- **C2 容器** → 应用架构
- **C3 组件 / C4 代码** → 技术架构、数据架构与各模块详情

## 4A 架构文档

| 文档 | C4 层级 | 4A 领域 | 说明 |
| --- | --- | --- | --- |
| [业务架构](./business-architecture.md) | C1 System Context | 业务架构 | 用户角色、业务场景、领域术语、外部系统 |
| [应用架构](./application-architecture.md) | C2 Container | 应用架构 | 前端、后端、存储、外部服务及交互关系 |
| [技术架构](./technical-architecture.md) | C3 Component / C4 Code | 技术架构 | 技术栈、组件职责、通信协议、部署形态 |
| [数据架构](./data-architecture.md) | C2/C3 | 数据架构 | 数据实体、数据流、持久化、生命周期与安全 |

## 技术横切关注点

| 文档 | 说明 |
| --- | --- |
| [记忆系统设计](./memory-system.md) | 前后端记忆一致性、SessionMemory、Resource Identity、thread 映射 |
| [存储系统设计](./storage-system.md) | LibSQL 与 DuckDB 的分工、MastraCompositeStore 路由、本地/部署形态 |

## 模块详情（C4 Code 视角）

| 文档 | 覆盖源码 | 重点 |
| --- | --- | --- |
| [后端入口](./backend-entry.md) | `src/index.ts` | Express + MastraServer + CopilotKit Runtime 装配 |
| [Mastra 核心](./mastra-core.md) | `src/mastra/index.ts` | Mastra 实例、复合存储、可观测性 |
| [Agent 层](./agents.md) | `src/mastra/agents/` | weather / general / activity-planner 三个 Agent |
| [工具层](./tools.md) | `src/mastra/tools/` | 天气、网页抓取、无头浏览器、反爬识别 |
| [工作流](./workflows.md) | `src/mastra/workflows/` | `weatherWorkflow` 的两步编排 |
| [处理器](./processors.md) | `src/mastra/processors/` | `ToolResultTrimmer` 历史消息压缩 |
| [前端工作区](./frontend-workspace.md) | `src/client/` | 状态模型、受控聊天、UI 组件 |
