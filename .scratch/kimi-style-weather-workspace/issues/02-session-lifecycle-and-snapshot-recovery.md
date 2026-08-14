# 02 — 实现会话创建、切换和快照恢复

**What to build:** 用户可以新建会话、查看按时间分组的 Session History、打开历史会话并恢复完整 Message Snapshot；新会话归属于 Active Project，继续聊天仍通过现有流式 Weather Copilot 链路完成。

**Blocked by:** 01 — 建立浏览器工作区状态边界

**Status:** completed

- [x] 新建会话前保存当前 Active Session，并在 Active Project 下创建并切换到空会话
- [x] 第一条用户消息生成去除换行后的前 24 个字符标题，用户可以手动重命名
- [x] Session History 按“今天、昨天、更早”分组，并在组内按更新时间倒序排列
- [x] 点击历史会话后加载目标会话的完整 Message Snapshot
- [x] 切换会话不会改变目标会话的 Project 归属
- [x] 删除会话需要确认，并打开同项目中最近更新的其他会话；没有其他会话时创建空会话
- [x] 受控聊天视图能够提交和接收流式消息，并把完整消息对象保存回 Active Session
- [x] 现有 `/api/copilotkit`、`weatherAgent` 和 Resource Identity 链路继续工作
- [x] 会话生命周期和消息快照行为测试覆盖创建、标题、历史、切换、删除和恢复

已知限制：流式进行中切换到其他会话时，旧会话的后续增量不会实时写回其快照；切回该会话时，按 threadId 缓存的 agent 会把完整消息同步回快照。删除/重命名使用原生 confirm/prompt，应用内自定义弹窗留待 04 号 UI 票。
