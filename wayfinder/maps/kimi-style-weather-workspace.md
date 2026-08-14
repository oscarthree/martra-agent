# Kimi 风格天气工作区

## Destination

形成一份可直接交给实现阶段执行的前端改造决策：将当前 Weather Copilot 改造成 Kimi 风格的天气工作区，支持浏览器持久化的新建会话、项目、会话历史、项目选择和新建项目，同时保留现有 `/api/copilotkit`、Mastra 和流式聊天链路。

## Notes

领域：天气聊天工作区、项目和会话管理、响应式前端交互。

本地图默认只产出决策，不直接实现功能。需要关注现有 CopilotKit v2、AG-UI、Mastra resource ID 和浏览器存储约束。视觉参考为 Kimi 官网公开页面，但保留 Weather Copilot 的品牌与天气内容。

## Decisions so far

- 已在对话中确认：采用可实际使用的前端工作区，项目和会话先保存在浏览器。
- 已在对话中确认：采用 Kimi 风格的浅色工作区、约 240px 桌面侧栏、顶部项目上下文栏和移动端抽屉。
- 已在对话中确认：左侧提供新建会话、项目和会话历史；项目支持新建、选择、重命名和删除。
- 已在对话中确认：会话按时间分组，保存标题、消息、所属项目和更新时间；删除项目时会话进入未分类。
- 已在对话中确认：会话切换优先采用前端消息快照，继续使用现有 resource ID，不新增后端线程接口。
- 已在对话中确认：引入 `lucide-react`，并通过桌面、移动端截图和实际交互验收。
- 已在领域建模中确认：工作区是顶层环境；项目是组织会话的单元；会话历史是导航视图，不是独立实体。
- 已在领域建模中确认：未分类是不可重命名的虚拟分组；删除项目只会解除会话归属，不会删除会话。
- 已在领域建模中确认：项目选择器切换活动项目和历史筛选范围，但不移动当前会话，也不自动打开另一段会话；全部历史入口保留跨项目查看能力。
- [确认 CopilotChat 消息快照恢复能力](../tickets/confirm-chat-snapshot-recovery.md) — `CopilotChat` 不支持受控消息，前端恢复必须改用受控的 `CopilotChatView`；后端 thread 持久化不在本轮范围。
- [定义浏览器工作区持久化模型](../tickets/define-workspace-persistence.md) — 使用版本化单一 localStorage 工作区，保存项目、会话和完整 AG-UI 消息快照；与 Mastra resource ID 分离。
- [定义会话与项目生命周期](../tickets/define-session-project-lifecycle.md) — 明确新建、切换、重命名、删除、未分类和历史分组规则，空会话不进入历史。
- [定义 Kimi 风格工作区视觉契约](../tickets/define-kimi-workspace-visual-contract.md) — 确定 A+C 桌面布局、洋红色 Weather Copilot 交互色、移动端抽屉、项目选择器、状态反馈、可访问性和浅色主题范围。
- [实现 Kimi 风格天气工作区](../tickets/implement-kimi-style-weather-workspace.md) — `ready-for-agent` 实现规格，统一描述工作区状态边界、受控聊天恢复、响应式 UI、持久化和验收要求。

## Implementation tickets

- [01 — 建立浏览器工作区状态边界](../../.scratch/kimi-style-weather-workspace/issues/01-workspace-state-boundary.md) — 无阻塞，可立即开始。
- [02 — 实现会话创建、切换和快照恢复](../../.scratch/kimi-style-weather-workspace/issues/02-session-lifecycle-and-snapshot-recovery.md) — 阻塞于 01。
- [03 — 实现项目生命周期和历史范围](../../.scratch/kimi-style-weather-workspace/issues/03-project-lifecycle-and-history-scope.md) — 阻塞于 01。
- [04 — 交付 Kimi 风格响应式天气工作区](../../.scratch/kimi-style-weather-workspace/issues/04-responsive-weather-workspace-ui.md) — 阻塞于 02、03。
- [05 — 完成错误处理、可访问性和最终验收](../../.scratch/kimi-style-weather-workspace/issues/05-error-accessibility-and-final-acceptance.md) — 阻塞于 04。

## Not yet specified

- 无。视觉契约与领域边界已确认，可以进入规格整理阶段。

## Out of scope

- 本轮不修改 `/api/copilotkit`、Mastra Agent、Tool、Workflow 或服务端 Memory。
- 本轮不实现跨浏览器、跨设备或账号级项目同步。
- 本轮不实现附件、知识库、项目级系统提示词、模型配置或批量会话管理。
- 本轮不复制 Kimi 的品牌、Logo、专属文案或受保护的视觉资产。
