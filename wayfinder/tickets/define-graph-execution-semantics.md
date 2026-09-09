# 定义图执行语义与 Mastra 编译路线

- Type: `wayfinder:grilling`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Assignee: kimi
- Blocking: 编写自定义 Agent 工作流编排实现规格

## Question

图 JSON → Mastra workflow 的编译与执行语义定型：会话输入如何进入开始节点、线程历史如何注入 LLM 节点、条件分支的求值规则、节点失败（工具报错/LLM 异常）的行为、最终文本如何流式聚合回聊天。前置依赖「调研 Mastra 运行时动态编译执行 workflow 的可行性」与「定义 workflow 图 DSL」。

## Resolution

方案经逐条确认（Q1–Q7 全部按推荐）。关键事实（本票会话内自查）：`@ag-ui/mastra` 只有 `getLocalAgents`，无任何 workflow 路由入口——面向聊天的执行体必须是 Agent。

- **执行入口（a 方案）**：每个定义动态注册一个 **WorkflowAgent**——`Agent` 子类，覆写 `stream()`：内部跑编译好的 workflow，把最终文本合成 `fullStream` chunk 序列返回。无 LLM 跳转、输出逐字保真。风险：与 @ag-ui/mastra 内部 chunk 协议耦合 → 由 [验证 WorkflowAgent 与 AG-UI 适配的 chunk 协议兼容](prototype-workflow-agent-ag-ui-compat.md) 先行原型验证；**fallback（b 方案，记录在案）**：常驻 dispatcher LLM agent + `runCustomWorkflow` 工具，接受每轮多一次模型调用与转述漂移风险。
- **路由与注册**：custom 会话 `runtimeAgentId = custom-<definitionId>`；首次消息到达时 ensure-registered（注册表没有则从 DB 加载定义 → 编译 → `addAgent`）；定义 `updatedAt` 变化时重新注册并令编译缓存失效。依据：CopilotKit 每请求现场枚举 agent，动态注册立即可路由（见 [调研 Mastra 运行时动态编译执行 workflow 的可行性](research-mastra-runtime-workflow-execution.md)）。
- **历史读写边界**：外层 WorkflowAgent 挂 `SessionMemory` 正常读写 thread（用户消息与最终回复进历史，与现有会话一致）；图内 LLM 节点用 `sessionMemory.recall()` **只读**历史、不写回，防止中间节点输入/输出污染会话历史。
- **条件求值**：先插值解析再比较；字符串语义为主；`gt`/`lt` 两侧 `Number` 强转，任一不可转则该分支 false；`isEmpty`/`notEmpty` 忽略 right；运行期未命中引用按空串（校验期已拦，运行期纯防御）。
- **失败行为**：工具 `ok:false` 是正常数据继续下传（条件节点可判断）；未捕获异常 → workflow failed → 聊天里 assistant 消息为明确错误说明（含失败节点名）；LLM 节点调用包 `withRetry`（仓库惯例）。
- **流式策略**：v1 用 `run.start()` 等终态，不用 `run.stream()` 中间事件；最终文本由外层一次性合成为流式 chunk；图整体执行 60 秒兜底超时。
- **编译缓存**：进程内 `Map<definitionId, { updatedAt, workflow }>` 按 `updatedAt` 失效；执行期才发现图变坏（如引用工具已被移除）走失败路径。
