# 02 — 自定义 Agent 定义存储与 REST API

**What to build:** 自定义 Agent 定义的服务端全生命周期（规格 §3）。复用同一 LibSQL 库新建应用层表（id / name / resource_id / graph / 创建与更新时间戳，resource_id 建索引），薄数据模块直接读写（不走 Mastra 存储域）。五个 REST 端点挂现有 Express，全部按 `x-mastra-resource-id` 头隔离（缺省 `"default"`）：列表（不含 graph）、详情（跨 resource-id 或不存在 → 404）、新建（只填名称，缺省带 start → llm → end 默认模板图）、更新（服务端跑 01 的完整校验，失败 400 带结构化错误列表）、删除（不做引用检查——保护在前端）。后端工具注册表清单随本票落地（全量暴露现有工具，新增工具自动可见）：既供 PUT 校验查 toolName，也供后续编辑器工具节点选项与编译使用。

**Blocked by:** [01 — 图 DSL 校验共享模块](01-workflow-dsl-validation.md)

**Status:** closed（2026-10-01）

**规格来源:** [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md) §3、§4.7、§7

- [x] 五端点行为符合规格 §3.2，curl 可验证全生命周期
- [x] 数据按 resource-id 隔离，跨 id 访问 404
- [x] PUT 校验失败返回 400 + 结构化错误列表
- [x] store 用内存 LibSQL 跑 CRUD 与 resource-id 隔离测试
- [x] `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿

**实施备注:**
- 架构分三层：`store.ts`（LibSQL CRUD，:memory: 可测）→ `service.ts`（纯函数返回 `{status, body}`，全部端点行为无 HTTP 可测）→ `api.ts`（Express 薄层，只解析 `x-mastra-resource-id` 头缺省 `"default"`）。冒烟用 curl 实测 10 个场景全过（默认模板 201、坏图 400、列表无 graph、改名、跨 resource 404、删除 404/200）。
- **工具注册表实际 id 是 kebab-case**：`get-weather` / `web-open-url` / `web-open-url-rendered`（规格里的 camelCase 是概称）。05 编辑器选项与 06 编译调工具都以注册表 id 为准。
- **PUT 按规格要求 `graph` 必填**（`{ name?, graph }`）：纯改名 = 先 GET 完整定义再带 graph PUT。管理区（03）按此实现改名。
- 「新增工具自动可见」的落地解释：本仓库工具本就没有集中注册（同 agent 约定），`tool-registry.ts` 现在是唯一登记处，新工具登记一处即对校验与编辑器两个消费方可见。
- 新直依赖 `@libsql/client@^0.17.4`、`nanoid@^3.3.18`（pnpm 严格隔离下传递依赖不可直接 import）；`pnpm-workspace.yaml` 的 `allowBuilds` 为 pnpm 12 安装时自动写入。
- code review 修复：删除引用不存在 ESLint 配置的注释、合并重复的 error helper、移除与 store 默认重复的显式 id 生成。
