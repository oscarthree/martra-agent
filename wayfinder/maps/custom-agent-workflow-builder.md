# 自定义 Agent 工作流编排

## Destination

产出一份可直接交给实现阶段执行的决策（ready-for-agent 规格）：工作区新增"自定义 Agent"能力——用户通过 Dify 风格的节点-连线可视化画布（`@xyflow/react`）编排 workflow 来定义 agent 行为；定义持久化在服务端 LibSQL、按 resource-id 隔离；运行时把图编译为 Mastra workflow 执行；项目级绑定（`agentType` 扩展为 weather / general / custom）。规格产出后走 tickets → `/implement`。

## Notes

领域：工作区项目/会话模型（术语见 `CONTEXT.md`）、Mastra workflow（createWorkflow/createStep）、AG-UI 路由（runtimeAgentId）、Dify 式可视化编排、`@xyflow/react`（React Flow v12）。

本地图只产出决策，不直接实现功能。Mastra 相关结论以 node_modules 类型定义为准（远端 mastra skill 不可用）。前端自定义样式变量一律用 `--wc-*` 前缀。新增 agent/tool/workflow 必须在 `src/mastra/index.ts` 注册。

## Decisions so far

- 已在对话中确认：本地图只产出决策与实现规格，不携带实现。
- 已在对话中确认：自定义 Agent 是项目 Agent Type 的并列扩展（weather / general / custom），custom 项目创建时多选一个具体 Agent 定义；沿用"创建时捕获、不可修改"语义。
- 已在对话中确认：只对齐 Dify 的交互范式与节点概念，DSL 按 Mastra 语义自定义，不做 Dify 文件级导入导出。
- 已在对话中确认：v1 节点面板 = 开始/结束 + LLM + 条件分支 + 工具调用；代码执行与循环不做。
- 已在对话中确认：Agent 定义存服务端 LibSQL 新表 + REST API，按 `x-mastra-resource-id` 隔离。
- 已在对话中确认：执行走编译路线——图 JSON 加载时编译为 Mastra workflow，复用其流式/重试/观测，不自研解释器；循环节点若将来引入需重新评估。
- 已在对话中确认：编辑器是独立全屏页面，从侧栏"自定义 Agent"管理区进入。
- 已在对话中确认：保存即生效（无草稿/发布）；被项目引用的 Agent 禁止删除并提示引用数；版本历史不做。
- 已在对话中确认：会话语义复用——`threadId = session.id`，开始节点收当前消息 + 线程历史（SessionMemory 不变），结束节点输出即 assistant 回复；图即 agent 行为全部，无额外 instructions。
- 已在对话中确认：LLM 节点模型固定 `kimi-k2.7-code`，节点可配 prompt 模板（变量插值），温度等参数不暴露。
- 已在对话中确认：工具节点由后端工具注册表清单驱动，全量暴露现有工具（weatherTool / webOpenUrl / webOpenUrlRendered），新增工具自动可见。
- 已在对话中确认：节点间数据传递用极简 `{{nodeId.output}}` 插值；开始节点暴露用户输入，LLM/工具节点暴露输出文本；不做类型系统。
- 已在对话中确认：保存时前后端双重校验（单一开始节点、无环、可达、插值引用存在），服务端保存 API 必须再验一次。
- 已在对话中确认：执行中聊天体验 v1 为整体流式输出最终文本；节点级执行进度进 fog。
- [调研 @xyflow/react 与 React 19 前端集成要点](../tickets/research-xyflow-react-flow-integration.md) — `@xyflow/react@12.11.6` 正式支持 React 19；受控状态模型 + `toObject()` 序列化开箱即用；`--xy-*` / `.react-flow__*` 与 `--wc-*` 零冲突；与本栈无集成障碍，编辑器可作为纯前端模块落地。
- [调研 Mastra 运行时动态编译执行 workflow 的可行性](../tickets/research-mastra-runtime-workflow-execution.md) — 可行：免注册 `createRun().start()` 直接执行、`.branch()` 条件分支、`run.stream().fullStream` 流式；Mastra 支持运行时 `addAgent`/`addWorkflow` 且 CopilotKit 每请求现场枚举，动态注册 agent 立刻可路由；SessionMemory 按 threadId 共享，节点 agent 需防历史写回污染。
- [定义 workflow 图 DSL](../tickets/define-workflow-graph-dsl.md) — 单一存储格式 = xyflow `toObject()` 形状 + 类型化 data；四节点字段定型（start/llm/tool/condition/end）；条件为结构化 `{left, op, right}` 八操作符、禁止嵌 JS；分支 if/else-if/else 短路（编译时取反链）；允许多个 end；`{{nodeId.output}}` 插值校验期拒绝悬空引用；孤儿节点保存即拒绝。
- [设计自定义 Agent 前端 UX 与编辑器](../tickets/define-custom-agent-frontend-ux.md) — 不引入路由库，编辑器为工作区内视图切换；三栏布局（节点面板/画布/右侧属性面板，节点不内嵌表单）；显式保存 + 顶部错误条 + 问题节点高亮，无自动保存；`isValidConnection` 做即时连线约束；新建带 start→llm→end 默认模板；会话侧 v1 零新增 UI。
- [定义自定义 Agent 数据模型与 API](../tickets/define-custom-agent-data-model-api.md) — 同一 LibSQL 库新建 `custom_agent_definitions` 表（id/name/resource_id/graph/时间戳）；REST API 五个端点按 `x-mastra-resource-id` 隔离；PUT 服务端跑完整 DSL 校验；删除不做服务端引用检查（引用数据在前端 localStorage，保护由前端实施）；DSL 校验器放 `src/shared/` 双端复用。
- [定义图执行语义与 Mastra 编译路线](../tickets/define-graph-execution-semantics.md) — 执行入口走 WorkflowAgent（Agent 子类覆写 stream 跑编译后的 workflow，无 LL 跳、输出保真；dispatcher LLM agent 为记录 fallback）；`runtimeAgentId = custom-<definitionId>`，ensure-registered + updatedAt 失效；LLM 节点 recall 只读历史防污染；工具 ok:false 为正常数据；`run.start()` 终态 + 合成流式，60s 兜底超时。
- [定义自定义 Agent 的项目绑定与会话路由](../tickets/define-custom-agent-binding-routing.md) — `agentType` 扩为 weather/general/custom，Project 与 Session 新增 `customAgentId` 且创建时捕获；存储版本不升 v2；`runtimeAgentId = custom-<customAgentId>`；引用到已删除定义的会话显示明确错误态、输入禁用、不降级；会话按 id 引用定义，更新即生效；前端管理数据走 REST API 而非 CopilotKit。
- [验证 WorkflowAgent 与 AG-UI 适配的 chunk 协议兼容](../tickets/prototype-workflow-agent-ag-ui-compat.md) — 验证通过，a 方案确认可行（原型 `.scratch/prototype-workflow-agent.ts`，协议层 SSE + 浏览器渲染双层验证）；合成流精确形状定型：`{ fullStream, traceId }` + as cast，chunk 最小序列 text-delta × N（必须带 truthy payload）+ finish，Agent 构造器 model 传 `{}` 即可。
- [编写自定义 Agent 工作流编排实现规格](../tickets/implement-custom-agent-workflow-builder.md) — **Destination 达成**：ready-for-agent 规格产出至 [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md)，覆盖 DSL/数据模型/API/编辑器/绑定路由/编译执行/测试策略/验收标准，交接 `/to-tickets` → `/implement`。

## Not yet specified

- 节点级执行进度穿透到聊天 UI（需 AG-UI 自定义事件，工作量不小）。
- 循环、代码执行、HTTP 请求、变量聚合等更重节点类型的引入时机与语义。
- Agent 定义的版本历史与草稿/发布分离。
- 同一 resource-id 下多人/多浏览器同时编辑同一 Agent 定义的冲突处理。

## Out of scope

- Dify workflow YAML 的文件级导入/导出兼容（DSL 语义不对齐，另一个数量级的工作量）。
- 跨 resource-id 共享或市场化分发 Agent 定义。
- 改造 weatherAgent / generalAgent 现有链路。
