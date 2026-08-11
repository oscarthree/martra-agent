# 01 — 建立浏览器工作区状态边界

**What to build:** 用户首次打开 Weather Copilot 时拥有默认项目和空会话；Workspace、Project、Session、Active Project、Active Session 和 Message Snapshot 能在浏览器中被读取、更新和恢复。刷新后状态保持，损坏存储或存储失败时仍保留可用的当前页面状态。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 首次打开创建名为“天气助手”的默认项目和一个空会话，并设置 Active Project 与 Active Session
- [x] Workspace 状态以版本化单一浏览器存储文档保存项目、会话、活动选择和完整 AG-UI Message Snapshot
- [x] 重新加载后恢复项目、会话、活动选择和完整消息对象
- [x] 空会话不进入 Session History，直到产生第一条用户消息
- [x] 不合法 JSON、未知版本或不符合结构的数据会重建默认工作区并显示轻量提示
- [x] 浏览器存储写入失败时保留当前内存状态并显示轻量提示
- [x] `mastra-resource-id` 与 project/session 标识保持独立
- [x] Workspace 状态边界行为测试覆盖默认初始化、序列化、恢复和存储错误
