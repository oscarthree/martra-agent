# 01 — 图 DSL 校验共享模块

**What to build:** 前后端双端复用的图校验事实标准（规格 §2）。任何图 JSON（xyflow `toObject()` 形状，version 1）经校验器输出「通过」或结构化错误列表：zod schema、插值引用存在性、恰好一个 start、至少一个 end 且全部从 start 可达、无环、无孤儿节点、condition 至少两个分支且兜底分支唯一只能在末位、toolName 须在工具注册表内（校验器以注册表名单为入参，模块本身保持零端依赖、不触碰网络/存储/DOM）。同一模块还提供运行期插值解析（`{{nodeId.output}}`，未命中引用防御性替换空串）与条件求值（八操作符：equals / notEquals / contains / notContains / gt / lt / isEmpty / notEmpty；先插值后比较；gt/lt 两侧 Number 强转、任一不可转则该分支 false；isEmpty / notEmpty 忽略 right）。本票是纯函数模块 + 测试，是整个特性的保存闸门地基。

**Blocked by:** None — can start immediately.

**Status:** closed（2026-10-01，commit 835314c）

**规格来源:** [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md) §2、§7

- [x] 保存校验七条规则每条都有正反用例（覆盖插值悬空、环、孤儿节点、兜底分支位置错误）
- [x] 插值解析与八操作符求值用例全绿（含类型强转失败、未命中引用空串）
- [x] 模块零端依赖，前后端均可直接 import
- [x] `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿

**实施备注:** code review 阶段按 spec §2.1/§2.2 补了两条例外校验——condition 出边必须经已声明的 `sourceHandle` 连出（`invalid_branch_edge`）、节点 id 唯一（`duplicate_node_id`）；`gt`/`lt` 空串按 Number() 语义强转为 0 的行为已用例钉死。产出 `src/shared/workflow-dsl.ts`（schema + 语义校验 + renderTemplate + evaluateConditionExpression），44 用例。
