# 03 — 侧栏自定义 Agent 管理区

**What to build:** 工作区侧栏新增"自定义 Agent"入口与管理区（规格 §5.3）。管理区列出自定义 Agent（名称 + 更新时间），操作：新建（只填名称，自动带 start → llm → end 默认模板图，开箱可跑）、重命名、删除。删除保护在前端：调删除 API 前扫描 localStorage 中的项目引用，被引用的定义删除禁用并提示引用数。前端 REST 客户端（自动带 `x-mastra-resource-id` 头）在本票落地，04/05 复用；列表内存缓存，进入管理区与新建项目弹窗时刷新。不引入路由库——管理区是工作区内视图切换（聊天 ↔ 管理/编辑），刷新回聊天视图。"编辑"动作的视图跳转在本票接线，编辑器组件本身由 05 实现（落地前编辑入口可为禁用占位）。

**Blocked by:** [02 — 自定义 Agent 定义存储与 REST API](02-custom-agent-store-api.md)

**Status:** closed（2026-10-01）

**规格来源:** [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md) §5.3、§7

- [x] 侧栏入口进入管理区，列表正确展示名称与更新时间
- [x] 新建只需名称，创建后带默认模板图（可经 API 验证）
- [x] 重命名、删除可用；被项目引用的定义删除禁用并显示引用数
- [x] 所有请求携带 resource-id 头，换 id 后列表为空（数据隔离）
- [x] `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿

**实施备注:**
- 新增 `custom-agent-api.ts`（REST 客户端 + resource-id 获取 + 按 resource-id 隔离的列表缓存，mock fetch 可测）与 `agent-manager.tsx`（管理区视图 + 新建/重命名对话框，复用 ConfirmDialog/Modal）。侧栏入口在 `workspace-ui.tsx`，视图切换在 `main.tsx`（`view: "chat" | "agents"` 纯 React state，刷新回聊天视图）。`currentResourceId()` 从 main.tsx 内联逻辑提取为共享函数。
- 重命名 = GET 完整定义 + 带 graph PUT（PUT 按规格 graph 必填，见 02 备注）。
- 编辑入口为禁用占位（票 05 实现编辑器视图时启用，届时把行内 `SquarePen` 按钮接上视图跳转）。
- 删除保护引用计数放在 workspace-state（结构类型参数，前向兼容 04 的 `customAgentId` 字段）；旧工作区计数自然为 0。
- code review 修复：列表缓存改为按 resource-id 键控（防跨身份泄漏）、三个写操作收尾合并为 runMutation、AgentNameDialog 的 mode 判断收敛。另给票 04 加了交接备注（弹窗打开时 force 刷新列表）。
- 已知边界（不修，属既有行为）：回复流式进行中切换视图/会话会丢失未落盘的流尾——与现有"流式中切换会话"行为一致，由 07 走查时确认。
- 既有 flake 记录：`web-open-url-rendered-tool.test.ts` 首个用例在全量跑时常压 5s 超时（基线提交上复现，与本草稿无关）；本票全部用例单跑与全量均绿。
