# 定义 workflow 图 DSL（节点/边 JSON 与校验规则）

- Type: `wayfinder:grilling`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Assignee: kimi
- Blocking: 定义自定义 Agent 数据模型与 API、定义图执行语义与 Mastra 编译路线

## Question

图定义的 JSON DSL 定型：node/edge 顶层结构；四种 v1 节点（start / llm / condition / tool）各自的字段与 zod schema；`{{nodeId.output}}` 插值的语法与解析规则（出现在哪些字段、未命中引用的行为）；保存时校验规则清单（单一开始节点、有且仅有可达的结束节点、无环、插值引用存在、工具名在注册表内）。

## Resolution

草案全文经逐条确认（Q1–Q7 全部按推荐）：

- **存储格式**：单一格式，即 xyflow `toObject()` 形状——顶层 `{ version: 1, viewport, nodes, edges }`；node 为 `{ id, type, position, data }`，edge 为 `{ id, source, target, sourceHandle? }`。前端画布与后端编译读同一份结构，后端 zod schema 是事实标准；`position`/`viewport` 后端无视但透传保存。
- **节点 id**：任意唯一字符串（编辑器生成 nanoid 风格），语义全由 `type` 决定；校验保证恰好一个 `start`。
- **四种节点 data**：
  - `start`：`{}`，运行时暴露 `output` = 当前用户消息。
  - `llm`：`{ prompt: string }`——指令模板，支持插值；线程历史由 SessionMemory **自动附带**，无需显式引用（显式开关如 `includeHistory` 留 fog）。
  - `tool`：`{ toolName: string, args: Record<string, unknown> }`——`toolName` 必须在后端工具注册表内；args 各字符串字段支持插值；`output` = 工具返回值的 JSON 字符串（整体，不做字段选择器）。
  - `condition`：`{ branches: [{ id, expression? }] }`——expression 为结构化对象 `{ left, op, right }`（left/right 支持插值），op ∈ `equals / notEquals / contains / notContains / gt / lt / isEmpty / notEmpty`；**禁止嵌入 JS 表达式**；无 expression 的分支为兜底。分支边经 `sourceHandle = branch.id` 连出。
  - `end`：`{ output: string }`——支持插值；**允许多个 end**，执行到哪个用哪个；运行时无任何 end 被到达则报错。
- **分支语义**：if / else-if / else 短路——按 branches 数组顺序求值、首个命中即停；编译为 Mastra `.branch()` 时给第 N 个分支自动附加"前 N-1 个均不成立"的取反条件（Mastra 原生是多 true 并行，见 [调研 Mastra 运行时动态编译执行 workflow 的可行性](research-mastra-runtime-workflow-execution.md)）。
- **插值**：语法 `{{nodeId.output}}`，可出现在 llm.prompt、tool.args 的字符串值、condition expression 的 left/right、end.output；引用不存在的节点/字段在**校验期拒绝**，运行期防御性替换为空串并记 warning。
- **校验规则**（保存时前后端双重，服务端为最终闸门）：恰好一个 start；至少一个 end 且所有 end 从 start 可达；无环；所有节点从 start 可达（孤儿节点 = 错误，保存拒绝）；插值引用存在；tool.toolName 在注册表内；condition 至少两个分支且兜底分支至多一个、只能在末位。
