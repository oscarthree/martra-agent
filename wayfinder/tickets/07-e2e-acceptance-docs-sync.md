# 07 — 全链路验收与文档同步

**What to build:** 特性整体走查收口（规格 §8）。在真实前后端环境（`pnpm start` + `pnpm client:dev`）下按规格验收标准逐条验证：侧栏新建/重命名/删除自定义 Agent 且新建自带默认模板；被引用删除禁用并提示引用数；新建"自定义助手"项目绑定定义，会话发消息得到按图执行的回复（LLM 节点插值引用 start.output、工具节点调真实工具、条件分支按预期走向、end 输出即最终回复）；定义更新后已绑定会话下一条消息即使用新图；删除定义后引用会话显示错误态且输入禁用；换 resource-id 后列表为空、数据隔离生效。同时做文档最终同步：`CONTEXT.md` 补 custom agentType / customAgentId / 自定义 Agent 定义等术语，`AGENTS.md` 同步代码结构与新模块注册说明。

**Blocked by:** [04 — 项目绑定与会话路由](04-custom-agent-binding-routing.md)、[05 — 可视化画布编辑器](05-graph-canvas-editor.md)、[06 — 编译执行链路](06-workflow-compile-execution.md)

**Status:** closed（2026-10-03）

**规格来源:** [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md) §8

- [x] 规格 §8 七条验收标准逐条通过
- [x] `CONTEXT.md` / `AGENTS.md` 与最终实现一致并已提交
- [x] `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿

**实施备注:**
- **验收方式**：新增 Playwright 全链路走查脚本 `.scratch/e2e-acceptance.ts`（未提交，属一次性验收工具；脚本首步会清空验收库全部定义，可重复运行）。运行手册：后端 `PORT=3210 TURSO_DATABASE_URL=file:.scratch/wc7-e2e/mastra.db MASTRA_DUCKDB_PATH=:memory: tsx src/index.ts`（项目 cwd，dotenv 自动供模型 key）+ 前端 `WC_API_TARGET=http://localhost:3210 vite --port 5174`，然后 `tsx .scratch/e2e-acceptance.ts`。为此给 `vite.config.ts` 与 `src/mastra/index.ts` 各加了一个可选环境变量（`WC_API_TARGET` / `MASTRA_DUCKDB_PATH`），互不干扰默认行为。
- **11/11 通过**（真实浏览器 + 真实后端 + 真实模型 + 真实 Open-Meteo）：①管理区 CRUD/编辑器默认模板/保存校验错误条 ②被引用删除禁用+引用数 ③a 工具节点（get-weather 真实调用+插值+end 输出）③b LLM 节点（插值引用 start.output，真实模型回复）③c 条件分支命中与兜底短路 ④PUT 改图后同一会话下一条消息即新图 ⑤删除定义后会话错误态且输入物理禁用 ⑥换 resource-id 列表为空。
- **验收抓到并已修的真实缺陷**：LLM 节点只读历史的 SessionMemory 未接 storage（`__registerMastra` 之外还需 `setStorage`，与 `Agent.getMemory()` 接线一致），错误表现为 "Memory requires a storage provider"；单测不覆盖（模型调用不进单测），由走查脚本兜底。
- 走查中的两个脚本侧教训（非产品缺陷）：get-weather 地理编码只认英文地名（`Dalian` 可用、`大连` 如实报错——天气 agent 的指令负责翻译，原始工具不翻译）；脚本已改为幂等（运行前清空验收库定义）。
- 文档同步：CONTEXT.md 三处补实现事实（工具注册表全量暴露给工具节点/删除保护与错误态/服务端存储与 resource 隔离+更新即生效）；AGENTS.md 同步运行时架构、技术栈、代码结构、前端要点（custom 路由推导/Gate/三视图/编辑器保存链）、环境变量、测试计数（14 文件 216 用例）。
