# 记忆系统设计（Memory System）

> 技术横切关注点（Cross-Cutting Concern）。记忆系统贯穿前端工作区、CopilotKit Runtime、Mastra Agent 与后端存储多个模块，说明 Weather Copilot 如何在本地工作区快照与后端 Mastra Memory 之间实现一致、可恢复、跨会话的对话记忆。

## 1. 设计目标

| 目标 | 说明 |
| --- | --- |
| 会话连续性 | 同一 session 的多轮对话能够记住前文 |
| 跨会话隔离 | 不同 session 默认不共享上下文，避免混淆 |
| 资源身份连续性 | 同一浏览器用户在不同 session 间共享服务端记忆身份 |
| 新会话无报错 | 首次进入空会话时不能因为“无 thread”而异常 |
| 前后端一致 | 本地 `localStorage` 快照与后端 Mastra Memory 不冲突、不循环 |

## 2. 核心概念

### 2.1 Resource Identity（资源身份）

- 由浏览器 `localStorage` 中的 `mastra-resource-id` 决定。
- 首次访问时随机生成 UUID，之后保持不变。
- 请求时通过 HTTP 头 `x-mastra-resource-id` 传到后端。
- 后端 Mastra 用该值作为 `resourceId`，将多个 thread 归到同一用户资源下。

```text
浏览器 localStorage
    │
    ├── mastra-resource-id = "uuid-xxx"  ──┐
    │                                       │ HTTP header
    ▼                                       ▼
WorkspaceState                          Express /api/copilotkit
(项目/会话/消息快照)                        │
                                            ▼
                                    CopilotRuntime
                                            │
                                            ▼
                                    MastraAgent.getLocalAgents({ resourceId })
                                            │
                                            ▼
                                    Mastra Memory (LibSQL)
                                    resourceId = "uuid-xxx"
```

### 2.2 Thread（线程）

- Mastra Memory 以 thread 为单位组织消息历史。
- 前端每个 `Session.id` 对应后端一个 `threadId`。
- 同一 `resourceId` 下可以有多个 thread（即多个 session）。

### 2.3 Message Snapshot（消息快照）

- 前端 `Session.messages` 是某时刻聊天内容的完整副本。
- 通过 `localStorage` 持久化，页面刷新后可恢复。
- 图片 part 在持久化前被替换为文本占位符。

## 3. 组件职责

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| `SessionMemory` | `src/mastra/agents/shared.ts` | 继承 `@mastra/memory`，将“No thread found”异常软化为空结果 |
| `Mastra Memory` | `@mastra/memory` | 基于 LibSQL 的 thread/message 存储与召回 |
| `LibSQLStore` | `src/mastra/index.ts` | 应用数据持久化，存储 thread、message、resourceId |
| `WorkspaceChat` | `src/client/main.tsx` | 管理 `useAgent`、消息同步、hydration |
| `workspace-state.ts` | `src/client/workspace-state.ts` | 本地快照模型、持久化、版本迁移 |

## 4. 记忆系统的调用关系

```text
用户发送消息
    │
    ▼
WorkspaceChat (useAgent)
    │ agentId = workspace-session-<session.id>
    │ runtimeAgentId = weatherAgent / generalAgent
    │ threadId = session.id
    │ resourceId = localStorage["mastra-resource-id"]
    ▼
CopilotKit Runtime ──POST──▶ /api/copilotkit
    │
    ▼
MastraAgent.getLocalAgents({ resourceId })
    │
    ▼
weatherAgent / generalAgent
    │
    ├── memory: SessionMemory
    │       │
    │       ├── recall({ threadId: session.id })
    │       │       │
    │       │       ▼
    │       │   LibSQL (thread messages)
    │       │       │
    │       │   若 thread 不存在 ──▶ 返回空数组（ softened ）
    │       │
    │       └── save / append messages
    │               │
    │               ▼
    │           LibSQL
    │
    ├── model: Moonshot
    │       │
    │       └── 结合历史生成回复 / 工具调用
    │
    └── tools / workflows
            │
            └── 执行后结果回写记忆
```

## 5. 前后端同步机制

### 5.1 首次进入会话（Hydration）

```typescript
const hydratedSessions = useRef<Set<string>>(new Set());

useEffect(() => {
  if (!hydratedSessions.current.has(session.id)) {
    hydratedSessions.current.add(session.id);
    agent.setMessages(session.messages);
    return;
  }
  // ...
}, [agent, session]);
```

原因：
- `useAgent` 的 agent 实例可能继承共享 runtime agent 上的旧消息。
- 首次进入必须以本地快照为准，显式 `agent.setMessages(session.messages)`。

### 5.2 后续同步： reconcileSessionMessages

```typescript
const sync = reconcileSessionMessages(agent.messages, session.messages);
if (sync === "restore-snapshot") {
  agent.setMessages(session.messages);
} else if (sync === "save-snapshot") {
  onMessagesChange(agent.messages);
}
```

| 同步方向 | 触发条件 | 动作 |
| --- | --- | --- |
| `in-sync` | 净化后两者一致 | 什么都不做 |
| `restore-snapshot` | agent 侧为空，本地有消息 | 用本地快照覆盖 agent |
| `save-snapshot` | agent 侧有更新 | 将 agent 消息保存到本地 state |

### 5.3 图片占位的同步一致性

- 本地快照中的图片被 `sanitizeMessagesForStorage` 降级为 `"[图片未保存到本地]"`。
- agent 侧运行时仍保留真实 `image` part。
- `reconcileSessionMessages` 比较前先对 agent 消息做同样的 `sanitizeMessagesForStorage`。
- 这样两者被视为“一致”，避免无限循环的 save-render。

## 6. 为什么需要 `SessionMemory`

`@mastra/memory` 的 `recall()` 在 thread 不存在时会抛出：

```
No thread found
```

对于 Weather Copilot，新 session 的 `threadId` 在首次请求前确实没有对应记录，这是正常状态而非错误。`SessionMemory` 覆盖 `recall()`：

```typescript
export class SessionMemory extends Memory {
  override async recall(args) {
    try {
      return await super.recall(args);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No thread found")) {
        return { messages: [], total: 0, page: 0, perPage: false, hasMore: false };
      }
      throw error;
    }
  }
}
```

效果：
- 新会话首条消息不再触发 AG-UI 适配器的 "Failed to compute new-message diff" 警告。
- 真正的存储错误仍会继续抛出。

## 7. 记忆生命周期

### 7.1 新建会话

1. 前端创建 `Session`，`threadId = session.id`。
2. 后端尚无该 thread。
3. 用户发送第一条消息，`SessionMemory.recall()` 返回空历史。
4. LLM 处理消息后，Mastra 在 LibSQL 中创建 thread 并写入消息。

### 7.2 持续对话

1. 后续请求 `recall()` 返回已有消息。
2. LLM 基于完整历史生成回复或选择工具。
3. 新消息和工具结果追加到 thread。

### 7.3 切换会话

1. `threadId` 变为新 session.id。
2. 首次进入触发 hydration：用本地快照覆盖 agent 消息。
3. 若后端已有该 thread，则后续 `recall()` 加载后端历史；否则为空。

### 7.4 删除会话

- 前端从 `WorkspaceState.sessions` 中移除。
- 后端 Mastra Memory 中的 thread 记录**不会被主动清理**（当前实现）。
- 这意味着：同一 session.id 未来若被复用，后端仍可能保留旧历史。

> 当前设计依赖 session.id 的 UUID 唯一性，删除后重新创建同名 session 也是新 UUID，不会命中旧 thread。

## 8. 数据一致性边界

| 来源 | 权威数据 | 用途 |
| --- | --- | --- |
| 后端 Mastra Memory | 权威对话上下文 | LLM 实际用于生成回复的历史 |
| 前端 localStorage 快照 | 用户看到的聊天视图 | 页面刷新后恢复、历史列表展示 |
| `x-mastra-resource-id` | 权威资源身份 | 将多个 thread 关联到同一用户 |

关键边界：
- 本地快照可能滞后于后端记忆（流式生成过程中）。
- 同步以 agent 侧为更可信的“最新状态”，本地快照是渲染/恢复用途。
- 多标签页同时操作同一会话可能导致本地快照覆盖冲突（当前由 last-write-wins 处理）。

## 9. 设计要点总结

1. **资源身份与会话分离**：`resourceId` 是用户维度，`threadId` 是会话维度，二者共同定位 Mastra Memory 中的历史。
2. **软化新会话异常**：`SessionMemory` 将“无 thread”视为空历史，保证首条消息流畅。
3. **前后端双写**：后端写 Mastra Memory，前端写 localStorage 快照，通过 `reconcileSessionMessages` 定期对齐。
4. **图片不持久化**：base64 图片只存在于运行时内存与后端记忆中，前端持久化降级为占位文本。
5. **thread 不随前端删除而清理**：简化实现，依赖 UUID 唯一性避免误用旧历史。
