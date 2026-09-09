# 定义自定义 Agent 数据模型与 API

- Type: `wayfinder:grilling`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Assignee: kimi
- Blocking: 编写自定义 Agent 工作流编排实现规格

## Question

服务端持久化定型：LibSQL 表结构（agent 定义 id、名称、图 JSON、resource_id、时间戳等）；REST API 形状（列表/读取/创建/更新/删除，删除时的引用检查）；与 Mastra 存储（mastra.db）的关系——复用同一 LibSQL 实例还是独立表空间；`x-mastra-resource-id` 隔离的实施位置。前置依赖「定义 workflow 图 DSL」的图 JSON 结构。

## Resolution

方案经逐条确认（Q1–Q5 全部按推荐）。关键事实：项目/会话数据在浏览器 localStorage，服务端不知道引用关系——引用保护只能是前端行为。

- **存储**：复用同一 LibSQL 数据库（开发 `file:./mastra.db` / 部署 Turso），新建应用层表 `custom_agent_definitions`；薄数据模块用 `@libsql/client`（`@mastra/libsql` 既有依赖）读同一组 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` 环境变量。不走 Mastra 存储域（那是框架内部数据的抽象，自定义业务表直接建表更简单）。
- **表结构**：`id TEXT PRIMARY KEY`（nanoid）、`name TEXT NOT NULL`、`resource_id TEXT NOT NULL`、`graph TEXT NOT NULL`（DSL JSON 字符串，内含 `version` 字段）、`created_at` / `updated_at` 整数时间戳；索引 `(resource_id, updated_at)`。无迁移框架：图结构演进靠 graph 内 `version`，表结构变更手动 ALTER。
- **API**（挂在现有 Express，全部按 `x-mastra-resource-id` 头隔离，缺省 `"default"`，与 Mastra Memory 同约定）：
  - `GET /api/custom-agents` — 列表，不含 graph（id / name / updatedAt）
  - `GET /api/custom-agents/:id` — 完整定义
  - `POST /api/custom-agents` — `{ name, graph? }`，缺省带 `start → llm → end` 默认模板图
  - `PUT /api/custom-agents/:id` — `{ name?, graph }`；服务端跑完整 DSL 校验（zod + 语义规则 + toolName 查注册表），失败 400 带错误列表
  - `DELETE /api/custom-agents/:id` — 直接删除；**服务端不做引用检查**（无引用数据），"被项目引用禁止删除"由前端调 API 前检查 localStorage 实施；会话引用到已删除定义时的行为由 [定义自定义 Agent 的项目绑定与会话路由](define-custom-agent-binding-routing.md) 回答
- **校验复用**：DSL 校验器（zod schema + 语义规则）放共享模块 `src/shared/workflow-dsl.ts`，前端编辑器保存前校验与服务端 PUT 校验用同一份代码；该模块不依赖任何端特有 API。
