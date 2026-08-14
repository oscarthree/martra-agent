# 确认 CopilotChat 消息快照恢复能力

- Type: `wayfinder:research`
- Parent map: [Kimi 风格天气工作区](../maps/kimi-style-weather-workspace.md)
- Status: closed
- Blocking: 前端会话恢复设计

## Question

当前使用的 CopilotKit v2 `CopilotChat` 是否提供稳定的初始消息/受控消息能力，使前端可以保存会话消息快照，并在切换历史会话时通过 `key` 重新挂载组件恢复消息？如果不支持，当前版本下最小可接受的历史恢复降级方案是什么？

## Resolution

`CopilotChat` 是非受控组件，不支持直接传入 `messages` 或 `initialMessages`；通过 `key` 重挂载只能重置组件，不能恢复本地快照。`CopilotChatView` 支持受控的 `messages` 和 `onSubmitMessage`，因此本轮应使用它实现前端快照恢复，并在切换会话时从本地快照回填。当前 `CopilotRuntime` SSE 路线不提供可直接复用的 durable thread 恢复能力；后端 thread 持久化留作后续范围。

参考：`node_modules/@copilotkit/react-core/skills/react-core/references/chat-components.md`、`node_modules/@copilotkit/react-core/dist/copilotkit-D0aAnD3i.d.mts`。
