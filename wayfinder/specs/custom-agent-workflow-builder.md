# 自定义 Agent 工作流编排 — 实现规格

- 来源地图：[wayfinder/maps/custom-agent-workflow-builder.md](../maps/custom-agent-workflow-builder.md)
- 状态：ready-for-agent（全部 9 张决策票已关闭，决策以各票 Resolution 为准，本文是汇总；冲突时以票为准）
- 交接路径：本规格 → `/to-tickets` 拆实现票 → `/implement`

## 1. 范围与非目标

**范围**：工作区新增第三类 Agent（custom，与 weather / general 并列）。用户通过 Dify 风格的节点-连线可视化画布（`@xyflow/react`）编排 workflow 定义 agent 行为；定义持久化在服务端 LibSQL、按 `x-mastra-resource-id` 隔离；运行时图 JSON 编译为 Mastra workflow，由动态注册的 WorkflowAgent 驱动执行；项目创建时绑定定义（创建后不可改），会话经 `runtimeAgentId = custom-<definitionId>` 路由。

**非目标**（地图 Out of scope / fog，本规格不覆盖）：

- Dify YAML 文件级导入导出；跨 resource-id 共享/分发。
- 循环、代码执行、HTTP 请求、变量聚合节点；节点级执行进度穿透聊天 UI；版本历史与草稿/发布；多人同时编辑冲突处理。
- 改造 weatherAgent / generalAgent 现有链路。

## 2. 图 DSL 与校验

事实标准为共享模块 **`src/shared/workflow-dsl.ts`**（zod schema + 语义校验），前端编辑器保存前校验与服务端 PUT 校验跑同一份代码；模块不依赖任何端特有 API。

### 2.1 存储格式

单一格式 = xyflow `toObject()` 形状：

```jsonc
{
  "version": 1,            // 图结构演进靠此字段
  "viewport": { "x": 0, "y": 0, "zoom": 1 },   // 后端无视但透传保存
  "nodes": [{ "id": "n1", "type": "llm", "position": { "x": 0, "y": 0 }, "data": { /* 按类型 */ } }],
  "edges": [{ "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "分支id（condition 出边必填）" }]
}
```

- 节点 id：任意唯一字符串（编辑器生成 nanoid 风格，**禁止数组 index**），语义全由 `type` 决定。
- 持久化时剔除 `measured` / `selected` 等运行时字段。

### 2.2 节点 data（v1 四种 + 开始/结束）

| type | data | 运行时 output |
| --- | --- | --- |
| `start` | `{}` | 当前用户消息文本 |
| `llm` | `{ prompt: string }`（支持插值；线程历史由 SessionMemory 自动附带，无需显式引用） | 模型回复文本 |
| `tool` | `{ toolName: string, args: Record<string, unknown> }`（args 字符串值支持插值；toolName 必须在后端工具注册表内） | 工具返回值的 JSON 字符串（整体，不做字段选择器） |
| `condition` | `{ branches: [{ id, expression? }] }`，expression = `{ left, op, right }`，op ∈ `equals / notEquals / contains / notContains / gt / lt / isEmpty / notEmpty`；**禁止嵌 JS**；无 expression 为兜底分支 | —（路由用） |
| `end` | `{ output: string }`（支持插值） | 最终回复文本 |

- 条件分支语义：if / else-if / else **短路**——按 branches 数组顺序求值，首个命中即停；编译为 `.branch()` 时给第 N 个分支附加"前 N-1 个均不成立"的取反链（Mastra 原生多 true 并行）。
- 分支边经 `sourceHandle = branch.id` 连出。
- **允许多个 end**，执行到哪个用哪个；运行期无任何 end 被到达 = 报错。

### 2.3 插值

- 语法 `{{nodeId.output}}`，可出现在：llm.prompt、tool.args 的字符串值、condition 的 left/right、end.output。
- 校验期：引用不存在的节点/字段 → **拒绝保存**。运行期：防御性替换为空串并记 warning。

### 2.4 保存时校验清单（前后端双重，服务端为最终闸门）

1. 恰好一个 start；
2. 至少一个 end 且所有 end 从 start 可达；
3. 无环；
4. 所有节点从 start 可达（孤儿节点 = 错误）；
5. 插值引用全部存在；
6. tool.toolName 在注册表内；
7. condition 至少两个分支，兜底分支至多一个且只能在末位。

## 3. 服务端：数据模型与 REST API

### 3.1 存储

- 复用同一 LibSQL 数据库（开发 `file:./mastra.db` / 部署 Turso），新建应用层表 `custom_agent_definitions`。**不走 Mastra 存储域**；薄数据模块用 `@libsql/client`（`@mastra/libsql` 既有依赖）读同一组 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`。
- 表结构：`id TEXT PRIMARY KEY`（nanoid）、`name TEXT NOT NULL`、`resource_id TEXT NOT NULL`、`graph TEXT NOT NULL`（DSL JSON 字符串）、`created_at` / `updated_at` 整数时间戳；索引 `(resource_id, updated_at)`。无迁移框架，表结构变更手动 ALTER。

### 3.2 REST API（挂现有 Express，全部按 `x-mastra-resource-id` 头隔离，缺省 `"default"`）

| 端点 | 行为 |
| --- | --- |
| `GET /api/custom-agents` | 列表，不含 graph（id / name / updatedAt） |
| `GET /api/custom-agents/:id` | 完整定义；跨 resource-id 或不存在 → 404 |
| `POST /api/custom-agents` | `{ name, graph? }`；缺省带 start → llm → end 默认模板图 |
| `PUT /api/custom-agents/:id` | `{ name?, graph }`；服务端跑完整 DSL 校验（zod + 语义规则 + toolName 查注册表），失败 400 带错误列表 |
| `DELETE /api/custom-agents/:id` | 直接删除；**服务端不做引用检查**（引用数据在前端 localStorage，保护由前端实施） |

## 4. 编译执行链路

### 4.1 执行入口：WorkflowAgent（a 方案，已经原型验证）

- 每个定义动态注册一个 **WorkflowAgent**：`Agent` 子类，覆写 `stream()`，内部跑编译好的 workflow，把最终文本合成 fullStream chunk 序列返回。无 LLM 跳转、输出逐字保真。
- 合成流精确形状（原型实测，见 `.scratch/prototype-workflow-agent.ts`）：返回普通对象 `{ fullStream, traceId }` + as cast；chunk 最小序列 `{ type: 'text-delta', runId, from: 'AGENT', payload: { id, text } }` × N + `{ type: 'finish', runId, from: 'AGENT', payload: {} }` 后 close；**chunk 必须带 truthy payload**，否则被适配器静默跳过；finish payload 字段不被读取。
- Agent 构造器 `model` 传 `{}`（构造器只 truthy 检查，stream 覆写后模型不会被触达）。
- Fallback（b 方案，记录在案不实施）：常驻 dispatcher LLM agent + `runCustomWorkflow` 工具。

### 4.2 路由与注册

- custom 会话 `runtimeAgentId = custom-<definitionId>`。
- **ensure-registered**：消息到达时注册表没有该 key → 从 DB 加载定义 → 编译 → `mastra.addAgent(agent, 'custom-<definitionId>')`（显式传 key；同 key addAgent 静默跳过）。
- 定义 `updatedAt` 变化 → 重新注册并令编译缓存失效。
- 依据：CopilotKit 每请求现场枚举 `mastra.listAgents()`（`src/index.ts` 传函数形式 agents），动态注册立即可路由。
- 编译缓存：进程内 `Map<definitionId, { updatedAt, workflow }>` 按 updatedAt 失效。

### 4.3 编译要点（@mastra/core@1.51.0 实测）

- `createWorkflow`/`createStep` 后必须 `commit()` 才能 `createRun()`（本版 async，无 `createRunAsync`）。
- 免注册 `run.start({ inputData })` 可行；**调用公开的 `workflow.__registerMastra(mastra)`** 拿存储/tracing 而不进注册表。
- step execute 的 `mastra` 参数类型必填但运行时为 undefined——LLM 节点**不得**依赖 `mastra.getAgent()`，节点 agent 在编译期闭包持有。
- `.branch([[条件函数, step], ...])`：条件函数内做取反链实现互斥短路；条件抛错按 false 处理；分支输出按 step id 合并。
- 插值求值在编译生成的 step 内做（读上游 step 输出表）。

### 4.4 历史读写边界

- 外层 WorkflowAgent 挂 `SessionMemory` 正常读写 thread（用户消息与最终回复进历史，与现有会话一致；`threadId = session.id`，resourceId 取 `x-mastra-resource-id`）。
- 图内 LLM 节点用 `sessionMemory.recall({ threadId, resourceId })` **只读**历史手动拼 prompt，不写回，防中间节点污染会话历史；节点 agent 必须挂 `SessionMemory` 以保留 "No thread found" 软化。

### 4.5 条件求值

先插值解析再比较；字符串语义为主；`gt`/`lt` 两侧 `Number` 强转，任一不可转则该分支 false；`isEmpty`/`notEmpty` 忽略 right；运行期未命中引用按空串（纯防御）。

### 4.6 失败行为与流式

- 工具 `ok: false` 是正常数据继续下传（条件节点可判断）；未捕获异常 → workflow failed → 聊天 assistant 消息为明确错误说明（含失败节点名）；LLM 节点调用包 `withRetry`（仓库惯例，见 `weather-workflow.ts`）。
- v1 用 `run.start()` 等终态（不用 `run.stream()` 中间事件；**不要对同一 run 先 stream 再 start**）；最终文本由外层一次性合成为流式 chunk；图整体执行 **60 秒兜底超时**。

### 4.7 工具注册表

后端工具注册表清单驱动编辑器工具节点选项；全量暴露现有工具（weatherTool / webOpenUrl / webOpenUrlRendered），新增工具自动可见。注册表同时供 DSL 校验查 toolName。

## 5. 前端

### 5.1 workspace-state 扩展（`src/client/workspace-state.ts`）

- `agentType` 联合扩为 `'weather' | 'general' | 'custom'`；Project 与 Session 各新增 `customAgentId?: string`（custom 时必填）。
- 旧数据天然合法，**存储版本不升（保持 v2）**，仅类型扩展。
- 捕获语义与 v2 同构：custom 项目创建时选定定义（不可修改）；Session 创建时从项目同时捕获 `agentType` 与 `customAgentId`；项目删除进未分类时两者保留。
- `runtimeAgentIdFor` 对 custom 会话返回 `custom-<customAgentId>`；`customAgentId` 缺失的 custom 会话视为错误态，不 fallback。

### 5.2 会话错误态

定义加载 404（已删除）时：聊天区显示明确错误态"该自定义 Agent 已被删除"，输入框禁用，不降级到任何 agent；用户可把会话移到其他项目或留在未分类。会话捕获定义 **id** 而非图快照，定义更新即生效。

### 5.3 导航与管理区

- 不引入路由库；编辑器是工作区内视图切换（聊天视图 ↔ Agent 管理/编辑器视图），侧栏新增"自定义 Agent"入口；视图状态进工作区 UI state，刷新回聊天视图。
- 管理区列出自定义 Agent（名称 + 更新时间），操作：编辑 / 重命名 / 删除；**删除保护在前端**：调 API 前扫 localStorage 项目引用，被引用的定义删除禁用并提示引用数。
- 新建只填名称，自动带 start → llm → end 默认模板图（开箱可跑，顺带演示插值）。
- 前端取数：直接调 `GET /api/custom-agents`（带 `x-mastra-resource-id` 头），不经 CopilotKit；列表内存缓存，进入管理区/新建项目弹窗时刷新。

### 5.4 编辑器（`@xyflow/react@^12.11.6`，正式支持 React 19）

- 三栏布局：左侧节点面板（四种节点卡片，点击或拖拽添加）、中间画布（节点只显示类型图标 + 名称/摘要，**不内嵌表单**）、右侧属性面板（选中节点时编辑其 data 字段）。
- 受控状态模型（`useNodesState`/`useEdgesState`/`addEdge`）；外层包 `<ReactFlowProvider>`；`import '@xyflow/react/dist/style.css'`；固定 `colorMode="light"`；`nodeTypes` 组件外定义 + 节点组件 `memo`；表单控件加 `className="nodrag"`；handler 全部 `useCallback`。
- 保存：显式保存按钮，前端先跑完整校验（共享模块）；失败时画布顶部错误条列出全部问题 + 问题节点红色高亮；全部通过才调 PUT。**不做自动保存**。
- 未保存保护：dirty 时切换视图或关闭页面弹确认（`beforeunload` + 视图切换拦截）。
- 连线规则（`isValidConnection` 即时约束）：start 无入边、end 无出边、禁止自连、禁止同节点对重复边、condition 出边必须从分支 handle 引出；环检测/可达性/插值悬空统一在保存时校验。
- 序列化：`instance.toObject()` 后剔除 `measured`/`selected` 再 PUT；恢复时 `setNodes`/`setEdges`/`setViewport`。
- 样式：xyflow 变量为 `--xy-*` 前缀，与 `--wc-*` 零冲突；覆写以 `.react-flow` 为作用域锚点；新增自定义样式仍用 `--wc-*`。

### 5.5 新建项目弹窗与会话侧

- 选"自定义助手"类型时出现 Agent 定义下拉（按名称排序）；无定义时显示空态文案 + "去创建"跳转；创建后不可改沿用现有语义。
- custom 会话聊天界面与现有完全一致，v1 零新增 UI（无画布缩略、无节点进度）；Agent 名称仅体现在项目/会话展示位；附件仍仅 general 会话开放。

## 6. 文件改动清单（规划）

新增：

- `src/shared/workflow-dsl.ts` — DSL zod schema + 插值解析 + 语义校验（双端复用）+ 测试
- `src/mastra/custom-agents/store.ts` — LibSQL 薄数据模块（建表 + CRUD）+ 测试（`:memory:`）
- `src/mastra/custom-agents/tool-registry.ts` — 后端工具注册表
- `src/mastra/custom-agents/compile.ts` — 图 JSON → Mastra workflow 编译（含条件取反链、插值求值、节点 step）+ 测试
- `src/mastra/custom-agents/workflow-agent.ts` — WorkflowAgent（stream 覆写 + 合成 fullStream + 60s 超时）+ 测试
- `src/mastra/custom-agents/registry.ts` — ensure-registered + 编译缓存 + updatedAt 失效 + 测试
- `src/client/custom-agent-api.ts` — REST 客户端（带 resource-id 头）
- `src/client/agent-manager.tsx` — 侧栏管理区 + 删除保护
- `src/client/agent-editor.tsx` — 三栏编辑器（节点面板/画布/属性面板/保存校验/未保存保护）

修改：

- `src/index.ts` — 挂 `/api/custom-agents` 五个端点
- `src/mastra/index.ts` — 注册 custom-agents 模块（AGENTS.md 约定）
- `src/client/workspace-state.ts` + 测试 — agentType/customAgentId 扩展
- `src/client/main.tsx` — 视图切换、错误态、runtimeAgentIdFor custom 分支
- `src/client/workspace-ui.tsx` — 侧栏入口、新建项目弹窗 Agent 选择器
- `src/client/styles.css` — 编辑器样式（`--wc-*`）
- `package.json` — 新增 `@xyflow/react` 依赖
- `CONTEXT.md` / `AGENTS.md` — 同步新结构与新术语

## 7. 测试策略

沿用仓库惯例（Vitest、同目录 `*.test.ts`、网络与模型调用不做集成测试、mock 外部依赖）：

- **DSL 校验器**：每条校验规则的正反用例（含插值悬空、环、孤儿、兜底分支位置）。
- **插值解析与条件求值**：八操作符、类型强转失败、未命中引用空串。
- **编译**：分支取反链结构断言（不执行真模型）；condition 短路语义用假 step 验证。
- **store**：LibSQL `:memory:` 跑 CRUD + resource-id 隔离。
- **WorkflowAgent**：合成 fullStream chunk 形状断言（对齐原型实测形状）；超时路径。
- **registry**：ensure-registered 幂等、updatedAt 失效重注册。
- **workspace-state**：custom 类型序列化/恢复/捕获语义/错误态推导。
- 提交前 `pnpm test` + `pnpm exec tsc --noEmit`。

## 8. 验收标准

1. 侧栏可新建/重命名/删除自定义 Agent；新建自带默认模板图，画布可编辑、保存校验报错可见。
2. 被项目引用的 Agent 删除被禁用并提示引用数。
3. 新建项目可选"自定义助手"并绑定定义；其会话发送消息，得到按图执行的回复（含 LLM 节点插值引用 start.output、工具节点调真实工具、条件分支按预期走向、end 输出即最终回复）。
4. 定义更新后，已绑定会话下一条消息即使用新图（无需重建会话）。
5. 删除定义后，引用它的会话显示"该自定义 Agent 已被删除"错误态且输入禁用。
6. 换 resource-id（清 localStorage 的 `mastra-resource-id` 或换浏览器）后列表为空，数据隔离生效。
7. `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿。
