# 前端工作区（Frontend Workspace）

> C4 层级：**C3 Component**（React SPA 容器内负责工作区与聊天的组件）。

## 1. 职责

前端工作区负责：

1. 管理 `WorkspaceState`（项目、会话、活动上下文）。
2. 通过 `localStorage` 持久化用户数据。
3. 使用 CopilotKit v2 受控 API 与后端 Agent 通信。
4. 提供侧栏、项目选择器、会话历史、弹窗等 UI。
5. 仅对通用助手会话开放图片附件。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/client/main.tsx` | 应用入口、WorkspaceChat、Welcome 组件 |
| `src/client/workspace-state.ts` | 纯函数状态模型与持久化逻辑 |
| `src/client/workspace-ui.tsx` | 侧栏、项目选择器、抽屉、弹窗等展示组件 |
| `src/client/styles.css` | 工作区样式（浅色主题） |

## 3. 关键类 / 函数

### 3.1 状态模型（workspace-state.ts）

| 名称 | 作用 |
| --- | --- |
| `WorkspaceState` | 工作区状态类型 |
| `Project` / `Session` | 项目与会话实体类型 |
| `AgentType` | `"weather" \| "general"` |
| `createDefaultWorkspace` | 创建默认工作区 |
| `loadWorkspace` / `saveWorkspace` | 读写 localStorage |
| `createProject` / `renameProject` / `deleteProject` | 项目 CRUD |
| `createSession` / `renameSession` / `deleteSession` | 会话 CRUD |
| `switchProject` / `switchSession` | 切换活动项目/会话 |
| `setSessionMessages` | 更新会话消息并派生标题 |
| `sanitizeMessagesForStorage` | 持久化前将图片 part 降级为文本占位符 |
| `reconcileSessionMessages` | 比较 agent 消息与本地快照，决定同步方向 |
| `groupSessionHistory` | 按今天/昨天/更早分组会话历史 |
| `runtimeAgentIdFor` | 将 `AgentType` 映射到 Mastra 注册键 |

### 3.2 UI 组件（workspace-ui.tsx）

| 组件 | 作用 |
| --- | --- |
| `Brand` | 顶部品牌标识 |
| `SidebarContent` | 侧栏：新建会话、项目列表、最近会话历史 |
| `ProjectContextSelector` | 顶部项目上下文下拉选择器 |
| `Drawer` | 移动端抽屉导航 |
| `Modal` | 通用模态框，带焦点陷阱 |
| `ProjectFormDialog` | 新建/重命名项目弹窗 |
| `SessionRenameDialog` | 重命名会话弹窗 |
| `ConfirmDialog` | 确认删除弹窗 |

### 3.3 聊天组件（main.tsx）

| 组件 | 作用 |
| --- | --- |
| `App` | 工作区状态管理、对话框调度、持久化节流 |
| `WorkspaceChat` | 每个会话的受控 CopilotChatView，管理 `useAgent` 与附件 |
| `Welcome` | 空会话欢迎页，按 `AgentType` 区分文案 |

## 4. 调用关系

```text
浏览器
    │
    ▼
App (main.tsx)
    ├── workspace-state.ts
    │       ├── loadWorkspace / saveWorkspace ─────▶ localStorage
    │       └── createProject / createSession / ...
    │
    ├── workspace-ui.tsx
    │       ├── SidebarContent
    │       ├── ProjectContextSelector
    │       └── Modal / Drawer / Dialogs
    │
    └── WorkspaceChat
            ├── useAgent({ agentId, runtimeAgentId, threadId })
            │       │
            │       └── CopilotKit ──POST──▶ /api/copilotkit
            │
            ├── useAttachments (general 会话)
            │
            └── reconcileSessionMessages
                    │
                    ▼
            setSessionMessages ─────▶ localStorage
```

## 5. C4 Code：关键代码

### 5.1 useAgent 配置

```typescript
const { agent } = useAgent({
  agentId: `workspace-session-${session.id}`,
  runtimeAgentId: runtimeAgentIdFor(session.agentType),
  threadId: session.id,
  updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
});
```

- `agentId`：前端会话级标识。
- `runtimeAgentId`：后端 Mastra 注册键（`weatherAgent` / `generalAgent`）。
- `threadId`：与会话 `id` 一致，后端按此存储记忆。

### 5.2 消息同步

```typescript
const hydratedSessions = useRef<Set<string>>(new Set());

useEffect(() => {
  if (!hydratedSessions.current.has(session.id)) {
    hydratedSessions.current.add(session.id);
    agent.setMessages(session.messages);
    return;
  }
  const sync = reconcileSessionMessages(agent.messages, session.messages);
  if (sync === "restore-snapshot") {
    agent.setMessages(session.messages);
  } else if (sync === "save-snapshot") {
    onMessagesChange(agent.messages);
  }
}, [agent, agent.messages, session, onMessagesChange]);
```

设计要点：
- 首次进入会话以本地快照覆盖 agent，避免克隆继承共享 runtime agent 上的旧消息。
- 之后比较 agent 与快照，决定恢复或保存。

### 5.3 图片占位

```typescript
export const IMAGE_PLACEHOLDER_TEXT = "[图片未保存到本地]";

export function sanitizeMessagesForStorage(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    if (!Array.isArray(message.content)) return message;
    if (!message.content.some((part) => part.type !== "text")) return message;

    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "text" ? part : { type: "text" as const, text: IMAGE_PLACEHOLDER_TEXT },
      ),
    };
  });
}
```

## 6. 设计要点

- **纯函数状态模型**：`workspace-state.ts` 不依赖 React，所有变更返回新 `WorkspaceState`，便于测试与持久化。
- **localStorage 版本迁移**：v1 数据自动升级为 v2，补充 `agentType`。
- **持久化节流**：300ms 延迟写入，避免流式更新频繁写盘。
- **附件仅通用助手**：`session.agentType === "general"` 才启用 `useAttachments` 与拖拽上传。
- **删除项目不删会话**：会话 `projectId` 置为 `null`，进入“未分类”。
- **响应式布局**：桌面显示固定侧栏，移动端使用抽屉导航。
