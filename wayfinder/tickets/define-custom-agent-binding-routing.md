# 定义自定义 Agent 的项目绑定与会话路由

- Type: `wayfinder:grilling`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Assignee: kimi
- Blocking: 编写自定义 Agent 工作流编排实现规格

## Question

工作区模型扩展定型：`agentType` 扩展为 weather / general / custom 对 workspace-state（当前 v2）的影响与迁移策略；Project/Session 上 custom Agent 定义 id 的存放位置与"创建时捕获"语义；`runtimeAgentIdFor` 对 custom 会话的路由推导（固定 dispatcher id 还是按定义 id 动态生成）；删除保护在前端的表现。

## Resolution

方案经逐条确认（Q1–Q6 全部按推荐）：

- **workspace-state**：`agentType` 联合扩为 `'weather' | 'general' | 'custom'`；Project 与 Session 各新增 `customAgentId?: string`（custom 时必填）。旧数据天然合法，**存储版本不升**（保持 v2），仅类型扩展。
- **捕获语义**：与 v2 完全同构——custom 项目创建时选定定义（`customAgentId`，不可修改）；Session 创建时从项目同时捕获 `agentType` 与 `customAgentId`；项目删除进未分类时两者保留。
- **路由推导**：`runtimeAgentIdFor` 对 custom 会话返回 `custom-<customAgentId>`（与 [定义图执行语义与 Mastra 编译路线](define-graph-execution-semantics.md) 对齐）；`customAgentId` 缺失的 custom 会话视为错误态，不 fallback。
- **引用到已删除定义的会话**（承接 [定义自定义 Agent 数据模型与 API](define-custom-agent-data-model-api.md) 的遗留问题）：定义加载 404 时聊天区显示明确错误态"该自定义 Agent 已被删除"，输入框禁用，不降级到任何 agent；用户可把会话移到其他项目或留在未分类。
- **定义更新的生效时机**：会话捕获定义 **id** 而非图快照；定义更新后所有绑定会话立即使用新图（与"保存即生效"一致，执行侧按 `updatedAt` 重新注册）；版本快照属 fog 里的版本历史。
- **前端取数**：直接调 `GET /api/custom-agents`（带 `x-mastra-resource-id` 头），不经 CopilotKit；列表前端内存缓存，进入管理区/新建项目弹窗时刷新。
