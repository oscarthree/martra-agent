# 验证 WorkflowAgent 与 AG-UI 适配的 chunk 协议兼容

- Type: `wayfinder:prototype`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Assignee: kimi
- Blocking: 编写自定义 Agent 工作流编排实现规格

## Question

「定义图执行语义与 Mastra 编译路线」的 a 方案依赖一个未证实的假设：`Agent` 子类覆写 `stream()`、返回手工合成的 `fullStream` chunk 序列，能被 @ag-ui/mastra 的 `MastraAgent` 正常驱动（text chunk 转成 AG-UI 文本事件、finish 正确收尾、前端 CopilotChatView 正常渲染）。

原型内容：最小 WorkflowAgent 子类（stream() 直接返回固定文本的合成流，不跑真 workflow）→ 动态 `addAgent` → 前端以 `runtimeAgentId` 指向它发一条消息 → 验证聊天 UI 正常收到并渲染回复。同时摸清合成 fullStream 需要哪些 chunk 类型（text-start/text-delta/text-end/finish 的确切形状）。

若验证失败：a 方案放弃，执行入口落到记录在案的 b 方案（dispatcher LLM agent + runCustomWorkflow 工具），实现规格按 b 编写。

## Resolution

**验证通过：a 方案（WorkflowAgent）确认可行，fallback（dispatcher LLM agent）不需要启用。**

原型：`.scratch/prototype-workflow-agent.ts`（一次性服务器，`WorkflowAgentProto extends Agent` 覆写 `stream()` 返回手工合成 fullStream，不调模型）。两层验证：

1. **协议层（curl → :3010）**：按 CopilotKit v2 single-route 信封 POST `/api/copilotkit`，SSE 返回 `RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT × 3 → TEXT_MESSAGE_END → RUN_FINISHED`，delta 文本与合成内容逐字一致。
2. **浏览器层（chrome-devtools → :5173，原型服务器临时以 `generalAgent` 键起在 :3000）**：在 general 会话发消息，聊天 UI 完整渲染合成回复"原型验证：WorkflowAgent 合成流正常，未调用任何模型。"，无报错、无卡死。

摸清的合成 fullStream 精确形状（实现规格直接引用）：

- `stream()` 返回值：**`@ag-ui/mastra` 只读 `fullStream`（ReadableStream，必须）和 `traceId`（可选）**；返回普通对象 `{ fullStream, traceId }` + as cast 即可，不需要真的构造 `MastraModelOutput`。
- chunk 最小序列：`{ type: 'text-delta', runId, from: 'AGENT', payload: { id, text } }` × N + `{ type: 'finish', runId, from: 'AGENT', payload: {} }`，然后 close。**chunk 必须带 truthy `payload`**（空对象也行），否则被适配器静默跳过；不需要 text-start/text-end chunk（适配器自行合成 AG-UI 的 START/END 事件）。finish payload 的具体字段不被读取。
- Agent 构造器对 `model` 只 truthy 检查：`new Agent({ id, name, instructions: '', model: {} as any })` 即可；stream 覆写后模型不会被触达。
- 适配器另会调 `getMemory()`：无 memory 时基类返回 `undefined`，安全短路，无需处理。
- `mastra.addAgent(agent, key)` 动态注册即刻可被路由（CopilotKit 每请求现场枚举 `mastra.listAgents()`），与调研票结论一致。
