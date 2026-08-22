# 02 — 工作区状态 v2：项目/会话类型与原地迁移

**What to build:** 浏览器工作区状态获得 agent 类型概念：每个 Project 带不可变的 `agentType`（`"weather"` / `"general"`），每个 Session 在创建时从所属项目捕获类型，项目删除进入未分类后会话类型不变。用户浏览器里已有的 v1 工作区数据在加载时原地升级（存储 key 不变），所有既有项目和会话补为天气助手类型，标题、消息快照、当前选中项全部保留；损坏数据或未知版本仍走既有恢复路径（保留内存状态、清除损坏数据、重建默认工作区、轻量提示）。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Project 与 Session 类型新增 `agentType` 字段；新建会话从当前活动项目捕获类型；新建项目可指定类型（默认 `weather`）
- [ ] 删除项目后原项目会话进入未分类，`agentType` 保持创建时的值不变
- [ ] 状态版本升到 2，localStorage 存储 key 保持 `weather-copilot-workspace-v1` 不变；加载时 v1 载荷先经纯迁移函数升级（全部项目/会话补 `weather`）再校验
- [ ] 未知版本、非法 `agentType`、校验失败、JSON 解析失败均落入既有默认工作区恢复路径
- [ ] 默认项目"天气助手"类型为 `weather`；既有生命周期函数（新建/切换/重命名/删除/分组/筛选）行为不变
- [ ] 同目录 Vitest 单测覆盖：v1→v2 迁移完整性、v2 序列化/解析往返、非法值拒绝、创建捕获、删项目后类型存活、既有生命周期回归；沿用注入 `now`/`createId` 的既有测试风格
- [ ] `pnpm test` 与 `pnpm exec tsc --noEmit` 通过
