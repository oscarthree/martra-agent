# 调研 Mastra 运行时动态编译执行 workflow 的可行性

- Type: `wayfinder:research`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Blocking: 定义图执行语义与 Mastra 编译路线

## Question

自定义 Agent 的图 JSON 要在运行时编译为 Mastra workflow 并执行，需查明（以 node_modules 已安装版本的类型定义和源码为准）：a) `createWorkflow`/`createStep` 能否不注册进 Mastra 实例直接 `createRun().start()` 执行，注册与否的差别（存储、观测、流式）；b) 条件分支的 API 形态（`.branch()` 或其他）；c) workflow 流式输出如何聚合为一段 assistant 文本接入 AG-UI；d) 动态自定义 agent 如何接入现有 `runtimeAgentId` 路由——Mastra 实例能否运行时增删 agent，还是需要一个 dispatcher agent 按定义 id 加载图执行；e) 动态执行如何挂 `SessionMemory`（threadId = session.id）。

## Resolution

**可行。动态注册与 dispatcher 两条路线都成立，动态注册链路更直接。** 以下证据全部取自实际安装版本 `@mastra/core@1.51.0`（pnpm store 里另有 1.57.0，升级后需重新核对命名）。

1. **免注册直接执行**：已证实可行。`createRun()`（本版为 async，无 `createRunAsync`）→ `run.start({ inputData })`。不注册则快照持久化与 tracing 静默跳过（mastra 依赖全程可选链），流式不受影响（`pubsub ?? new EventEmitterPubSub()`）。两个坑：必须 `commit()` 后才能 `createRun`；step execute 的 `mastra` 参数类型必填但运行时为 undefined，LLM 节点不得依赖 `mastra.getAgent()`。中间方案：编译后调公开的 `workflow.__registerMastra(mastra)` 拿存储/tracing 而不进注册表。
2. **条件分支**：`.branch([[条件函数, step], ...])`。所有条件并行求值，**多个 true 会并行执行多分支**（非 if/else 短路，互斥需在条件函数内自行取反）；分支输出按 step id 合并为 `{ [stepId]: output }` 供汇合 step 读取。条件抛错按 false 处理。
3. **流式**：`run.stream()` 返回 `WorkflowRunOutput`，`fullStream` 发 `workflow-step-output` 等事件、`output.result` 拿终态（判别联合 success/failed/suspended 等）；**不要对同一 run 先 stream() 再 start()**（后者二次执行）。step 内 LLM 子流需手动迭代 `agent.stream()` 并 `writer.write(chunk)` 转成 `workflow-step-output` 事件。
4. **动态路由**：Mastra 类有运行时 `addAgent(agent, key?)`/`removeAgent`/`addWorkflow(workflow, key?)`（addWorkflow 会自动 commit；无 removeWorkflow；同 key addAgent 静默跳过）。`MastraAgent.getLocalAgents` 每次现场 `mastra.listAgents()` 无缓存，且 src/index.ts 传给 CopilotKit 的是函数形式、每请求重新解析——**运行时 addAgent 的 agent 立刻可被前端路由到**（自定义路由 id 需显式传 key）。dispatcher agent（工具里 createRun→start）同样可行。
5. **Memory**：thread 存储只按 threadId 索引、resourceId 仅做归属校验，无 agent 维度隔离。推荐落法（机制已证实、组合为推断）：dispatcher/节点执行时从 `context.agent.threadId/resourceId`（或 requestContext 的 `mastra__threadId`/`mastra__resourceId` 键）取线程标识 → 传入 workflow inputData → LLM 节点用共享 SessionMemory agent 以 `memory: { thread, resource }` 调 generate；注意节点 agent 默认会把输入/输出写回该 thread（可能污染会话历史），只读历史则改用 `sessionMemory.recall({ threadId, resourceId })` 手动拼 prompt。节点 agent 必须挂 `SessionMemory` 以保留 "No thread found" 软化。
