# 06 — 编译执行链路（图 → Mastra workflow → WorkflowAgent）

**What to build:** custom 会话消息的按图执行（规格 §4）。编译器把图 JSON 编译为 Mastra workflow：每节点一个 step；condition 编译为 `.branch()`，给第 N 个分支附加"前 N-1 个均不成立"的取反链实现互斥短路（条件抛错按 false）；插值在 step 内对上游输出表求值；LLM 节点用编译期闭包持有的节点 agent——不得依赖 step execute 的 `mastra` 参数（运行时为 undefined），经 `sessionMemory.recall` 只读线程历史拼 prompt、不写回（防中间节点污染会话历史），LLM 调用包 withRetry；工具节点 `ok: false` 作为正常数据下传；未捕获异常 → workflow failed → 明确错误说明含失败节点名。WorkflowAgent（Agent 子类）覆写 `stream()` 执行编译产物：`run.start()` 等终态（图整体 60s 兜底超时，不对同一 run 先 stream 再 start），最终文本一次性合成 fullStream chunk 序列返回。ensure-registered：消息到达而注册表无该 key 时，从 DB 加载定义 → 编译 → 显式 key 动态注册；定义 updatedAt 变化 → 重注册并使编译缓存失效。外层 agent 挂 SessionMemory 正常读写 thread（与现有会话一致）。

**Blocked by:** [02 — 自定义 Agent 定义存储与 REST API](02-custom-agent-store-api.md)（从 DB 加载定义）

**Status:** closed（2026-10-02）

**规格来源:** [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md) §4、§7

**原型实测的流形状**（来自 `.scratch/prototype-workflow-agent.ts` 的协议验证，精确对齐）：`stream()` 返回普通对象 `{ fullStream, traceId }` + as cast；chunk 最小序列 `{ type: 'text-delta', runId, from: 'AGENT', payload: { id, text } }` × N，随后 `{ type: 'finish', runId, from: 'AGENT', payload: {} }` 后 close。**chunk 必须带 truthy payload**，否则被适配器静默跳过；finish payload 字段不被读取；Agent 构造器 `model` 传 `{}` 即可。

- [x] 编译测试：分支取反链结构断言（不执行真模型）、condition 短路语义用假 step 验证
- [x] WorkflowAgent 合成 fullStream chunk 形状对齐原型实测形状；60s 超时路径有测试
- [x] registry：ensure-registered 幂等、updatedAt 失效触发重注册
- [x] 经运行时接口（不经完整 UI）驱动 custom 会话，得到按图执行的流式回复
- [x] `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿

**实施备注:**
- 产出 `compile.ts`（图→workflow 编译）、`workflow-agent.ts`（stream 覆写+合成流+超时+历史落盘）、`registry.ts`（ensure-registered+updatedAt 失效），`withRetry` 提取为 `src/mastra/utils/retry.ts`（weather-workflow 同步重构），workflow-dsl 增 `extractTemplateNodeIds`。
- **thenable 陷阱（重大，已写进代码注释）**：`Workflow.then` 是链式构建方法，`await workflow` / `Promise.resolve(workflow)` / async 函数直接 return 都会被 Promise 收养为 thenable 永远挂起。编译结果一律包 `{ workflow }` 传递，`compileWorkflow` 为同步函数。
- **节点历史只读**：LLM 节点 agent 编译期闭包持有、不挂 memory（Mastra agent.stream 挂 memory 会自动持久化，违反"不写回"）；recall 走编译期共享的 SessionMemory（保留 No thread found 软化）。`runId` 显式传入 workflow run，节点输出登记/清理同键。
- **分支编译**：顶层条件→`.branch` 取反链；分支内多节点链/内嵌条件→复合 step 手工顺序解释（语义同取反链）；分支后汇聚→`.then` 续链；分支直连 end 用真实 end step。**v1 限制（编译期明确报错）**：非条件节点多出边、悬空链、多分支指向同一节点、内嵌条件后再汇聚。
- 错误说明含失败节点 id（从 failed run 的 steps 里提取）；单个定义损坏只记日志不影响其他定义注册。
- e2e 冒烟（隔离目录起服务，LLM-free 图）：POST /api/copilotkit `agent/run` 走通 RUN_STARTED→TEXT_MESSAGE_CHUNK（插值正确）→RUN_FINISHED；PUT 改图后下一请求即用新图。
- code review 共修复：单节点分支丢 end 模板、dispose runId 不同源、LLM 节点写回污染、withRetry 不覆盖流迭代、注册表单点故障、顶层 guard 静默退出。
