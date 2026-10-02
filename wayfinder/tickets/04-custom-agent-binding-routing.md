# 04 — 项目绑定与会话路由（custom agentType）

**What to build:** 工作区模型支持第三类 Agent（规格 §5.1、§5.2、§5.5）。`agentType` 联合扩为 weather / general / custom；Project 与 Session 各新增 `customAgentId`（custom 时必填），沿用"创建时捕获、不可修改"语义，Session 创建时从项目同时捕获 agentType 与 customAgentId，项目删除进未分类时两者保留；存储版本保持 v2（仅类型扩展，旧数据天然合法）。`runtimeAgentIdFor` 对 custom 会话返回 `custom-<customAgentId>`；customAgentId 缺失的 custom 会话视为错误态，不 fallback。新建项目弹窗选"自定义助手"时出现定义下拉（按名称排序；无定义时空态文案 + "去创建"跳转）。会话错误态：定义加载 404（已删除）时聊天区显示"该自定义 Agent 已被删除"，输入框禁用，不降级到任何 agent；会话捕获定义 id 而非图快照，定义更新即生效。custom 会话聊天界面 v1 零新增 UI，附件仍仅 general 开放。

**Blocked by:** [03 — 侧栏自定义 Agent 管理区](03-agent-manager-sidebar.md)（复用其 REST 客户端拉定义列表）

**Status:** closed（2026-10-02）

**规格来源:** [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md) §5.1、§5.2、§5.5、§7

**实现备注（来自 03 交接）:** 新建项目弹窗打开时要 `listCustomAgentSummaries({ force: true })` 强制刷新定义下拉（03 的缓存按 resource-id 隔离，非 force 读缓存）。删除保护只数项目引用；项目删除进未分类时会话仍持有定义 id，被删定义的会话按 §5.2 走错误态。

- [x] workspace-state 的 custom 类型序列化 / 恢复 / 捕获语义 / 错误态推导测试全绿
- [x] 新建 custom 项目可绑定定义，其会话正确推导 `custom-<id>` runtimeAgentId
- [x] 引用已删除定义的会话显示"该自定义 Agent 已被删除"错误态且输入禁用
- [x] 定义下拉含空态与"去创建"跳转
- [x] `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿

**实施备注:**
- `runtimeAgentIdFor` 签名改为接收会话形状（`{agentType, customAgentId}`），custom 缺 id 返回 `null`（错误态、绝不 fallback）；非 custom 走到 null 直接抛错（状态模型被破坏时宁可崩不静默降级）。门禁就绪分支的路由键与推导函数同一来源。
- WorkspaceChat 拆为壳（无 hook，按 agentType 分支）+ `CustomAgentGate`（hook：按 id 拉定义，404/缺 id → 错误面板不挂 useAgent，输入物理上不可用）+ `ChatView`（原实现，新增 runtimeAgentId prop）。
- `createProject` 对非 custom 类型丢弃传入的 customAgentId（绑定不变量，有用例）；弹窗仅在 create 模式拉定义列表；空列表/加载中/加载失败各有独立提交校验文案。
- v2 不升版：`customAgentId` 为可选字段，旧数据天然合法（有用例）；`isOptionalString` 过校验。
- code review 修复：删除死 fallback 与 `custom-${id}` 重复实现、rename 模式不再空拉列表、"去创建"单次关闭、空列表提交报错文案。
