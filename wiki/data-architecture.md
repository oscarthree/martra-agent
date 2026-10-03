# 数据架构（Data Architecture）

> 4A 架构视角之一，对应 C4 模型的 **C2 Container** 与 **C3 Component** 数据视图。
> 说明系统产生的数据实体、数据流、持久化位置、生命周期与安全策略。

## C2 Data Container View

```mermaid
C4Container
    title Data Container View - Weather Copilot
    Container_Boundary(browser, "浏览器") {
        ContainerDb(localStorage, "localStorage", "浏览器键值存储", "WorkspaceState 快照、mastra-resource-id")
    }

    Container_Boundary(backend, "后端服务") {
        ContainerDb(libsql, "应用数据库", "LibSQL / Turso", "线程、消息、记忆、资源身份")
        ContainerDb(duckdb, "可观测性数据库", "DuckDB", "span、trace、日志事件")
        Container(mastra, "Mastra", "", "通过 MastraCompositeStore 访问数据")
    }

    Container_Ext(openMeteo, "Open-Meteo", "天气数据")
    Container_Ext(moonshot, "Moonshot", "LLM 交互")

    Rel(browser, localStorage, "读写")
    Rel(browser, backend, "POST /api/copilotkit")
    Rel(mastra, libsql, "应用数据")
    Rel(mastra, duckdb, "可观测性数据")
    Rel(backend, openMeteo, "天气 API")
    Rel(backend, moonshot, "LLM API")
```

## 1. 数据实体总览

```text
┌─────────────────────────────────────────────────────────────┐
│                        前端工作区（localStorage）              │
│  WorkspaceState                                             │
│  ├── Project[]       (id, name, agentType)                  │
│  ├── Session[]       (id, projectId, agentType, title,      │
│  │                    messages, createdAt, updatedAt)       │
│  ├── activeProjectId                                        │
│  └── activeSessionId                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 会话/消息 + x-mastra-resource-id
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      后端 Mastra 存储（LibSQL）                │
│  Resource Identity ──▶ Thread ──▶ Messages                   │
│  （由 x-mastra-resource-id 关联）                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ tool calls / results
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   可观测性存储（DuckDB）                        │
│  Spans / Traces / Logs                                       │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心数据实体

### 2.1 Workspace（工作区）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | `number` | 当前为 `2`；v1 数据加载时自动迁移 |
| `projects` | `Project[]` | 项目列表，每个项目绑定不可修改的 `agentType` |
| `sessions` | `Session[]` | 会话列表，会话创建时从项目捕获 `agentType` |
| `activeProjectId` | `string` | 当前活动项目 |
| `activeSessionId` | `string` | 当前活动会话 |

### 2.2 Project（项目）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | UUID |
| `name` | `string` | 项目名称，唯一 |
| `agentType` | `"weather" \| "general"` | 助手类型，创建后不可修改 |
| `createdAt` / `updatedAt` | ISO string | 时间戳 |

### 2.3 Session（会话）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | UUID，同时作为 Mastra `threadId` |
| `projectId` | `string \| null` | 所属项目；删除项目后变为 `null`（未分类） |
| `agentType` | `"weather" \| "general"` | 创建时从项目捕获，之后不变 |
| `title` | `string` | 默认 `"新会话"`，首条用户消息自动生成 |
| `messages` | `Message[]` | 本地快照；图片被降级为文本占位符 |
| `createdAt` / `updatedAt` | ISO string | 时间戳 |

### 2.4 Message（消息）

- 遵循 `@ag-ui/core` 的 `MessageSchema`。
- `role` 包括 `user` / `assistant`。
- `content` 可以是字符串，也可以是 part 数组：
  - `text`：纯文本
  - `image`：base64 图片（仅运行时存在，不进入 localStorage）
  - `tool-invocation`：工具调用与结果（存在于 Mastra 记忆中）

### 2.5 Resource Identity（资源身份）

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `x-mastra-resource-id` | 浏览器 `localStorage` 中的 `mastra-resource-id` | 首次访问随机生成 UUID，后续保持不变 |
| 后端读取 | `request.headers.get("x-mastra-resource-id")` | 缺省为 `"default"` |
| 用途 | 关联 Mastra Memory | 同一浏览器会话在不同项目/会话间共享服务端记忆连续性 |

## 3. 数据流

### 3.1 正常对话数据流

```text
用户输入（文字/图片）
    │
    ▼
WorkspaceChat 组装 Message
    │
    ▼
agent.addMessage() → useAgent 内部状态
    │
    ▼
copilotkit.runAgent({ agent })
    │ POST /api/copilotkit
    ▼
CopilotRuntime → MastraAgent → weatherAgent / generalAgent
    │
    ▼
Mastra Memory（ThreadId = session.id, ResourceId = header）
    │
    ▼
LLM（Moonshot）生成回复或选择工具
    │
    ▼
Tool execute（如需要）
    │
    ▼
流式响应 → agent.messages 更新
    │
    ▼
onMessagesChange → setSessionMessages → localStorage 快照
```

### 3.2 工具结果在历史中的流转

1. 当前轮工具结果完整进入 LLM 上下文。
2. 多轮后，历史消息再次送入模型前，`ToolResultTrimmer` 将过大的 `html` 字段压缩到 4,000 字符以内。
3. 压缩仅在 `processInput` 阶段发生，不改变存储中的原始结果。

### 3.3 图片数据流

1. 用户上传图片 → `useAttachments` → `agent.addMessage()`（`image` part + base64）。
2. 后端 LLM 直接处理多模态输入。
3. 前端持久化前，`sanitizeMessagesForStorage` 将 `image` part 替换为文本占位 `"[图片未保存到本地]"`。
4. 刷新页面后，历史列表中图片位置显示占位文案；在线运行时仍可看到真实图片。

## 4. 持久化策略

### 4.1 localStorage（前端）

| 键 | 内容 | 说明 |
| --- | --- | --- |
| `weather-copilot-workspace-v1` | 完整 `WorkspaceState` JSON | 键名保留 `v1` 以兼容旧数据 |
| `mastra-resource-id` | UUID 字符串 | 资源身份标识 |

- 写入采用 300ms 节流，避免流式更新频繁写盘。
- 写入失败时显示顶部通知，不中断当前工作区。
- 加载失败/解析失败时自动重置为默认工作区。

### 4.2 LibSQL / Turso / MySQL（后端应用数据）

- 存储 Mastra 运行时的线程、消息、记忆、资源身份等。
- 开发时使用本地文件 `mastra.db`。
- 部署时可通过环境变量切换到 Turso 托管数据库。
- 生产环境也可通过统一适配器切换到 MySQL，由运维团队统一管理备份、监控与高可用。

### 4.3 DuckDB（后端可观测性数据）

- 存储 span、trace、日志事件。
- 本地文件 `mastra.duckdb`。
- 经 `MastraStorageExporter` 写入本地，可选 `MastraPlatformExporter` 上报云端。

## 4.4 LibSQL 与 DuckDB 的作用与区别详解

### 4.4.1 为什么需要两个后端存储

Weather Copilot 的后端数据在特征上天然分为两类：

| 数据类别 | 核心诉求 | 典型特征 |
| --- | --- | --- |
| 应用数据 | 事务性、低延迟、高可靠 | 每条消息、每个线程都需要持久化，支持按资源身份快速召回 |
| 可观测性数据 | 分析型、批量写入、大容量 | span/trace/log 数据量大，需要按时间范围聚合、检索、归档 |

单一数据库很难同时满足“高并发事务写入 + 低成本分析查询”的需求。Mastra 提供的 `MastraCompositeStore` 允许按 domain 路由到不同存储引擎，因此项目采用 **LibSQL 负责应用数据、DuckDB 负责可观测性数据** 的分离方案。

### 4.4.2 LibSQL 的作用

| 维度 | 说明 |
| --- | --- |
| **角色** | 应用主数据库，承载 Mastra Memory 与 Storage 的运行时数据 |
| **存储内容** | 线程（Thread）、消息（Message）、记忆上下文、资源身份（Resource Identity）、工作流状态、评估结果等 |
| **数据特征** | 结构化行数据、关系型、需要 ACID、随机读写频繁、按 `resourceId`/`threadId` 索引 |
| **本地形态** | `mastra.db` 文件（SQLite 兼容格式） |
| **托管形态** | Turso（分布式 SQLite/LibSQL），通过 `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` 切换 |
| **访问方式** | 通过 `@mastra/libsql` 的 `LibSQLStore`，挂载为 `MastraCompositeStore` 的 `default` domain |

LibSQL 在此项目中的关键价值：

- **与 SQLite 生态兼容**：开发阶段一个本地文件即可运行，零额外依赖。
- **线上可无缝切换到 Turso**：同一套 `LibSQLStore` 通过环境变量即可从本地文件切换到托管服务，便于部署。
- **支撑 Mastra Memory**：`SessionMemory` 依赖 LibSQL 中的 thread/message 表实现跨会话的服务端记忆连续性。

### 4.4.3 DuckDB 的作用

| 维度 | 说明 |
| --- | --- |
| **角色** | 可观测性数据库，专门存放 trace、span、log 等诊断数据 |
| **存储内容** | LLM 调用 span、工具调用 trace、工作流执行事件、Pino 日志、性能指标等 |
| **数据特征** | 半结构化/列式、写多读少、按时间范围批量分析、数据量大 |
| **本地形态** | `mastra.duckdb` 文件 |
| **托管形态** | 当前仅本地；可通过 `MastraPlatformExporter` 上报到 Mastra Platform |
| **访问方式** | 通过 `@mastra/duckdb` 的 `DuckDBStore`，挂载为 `MastraCompositeStore` 的 `observability` domain |

DuckDB 在此项目中的关键价值：

- **列式分析型查询**：针对 span/trace 的聚合、过滤、时间范围查询效率高于行式数据库。
- **文件型部署**：与 LibSQL 一样本地文件即可运行，降低开发环境复杂度。
- **独立生命周期**：可观测性数据可以单独清理、归档，不影响应用数据。

### 4.4.4 核心区别对比

| 对比维度 | LibSQL | DuckDB |
| --- | --- | --- |
| **主要职责** | 应用数据持久化 | 可观测性数据持久化 |
| **数据类型** | 线程、消息、记忆、资源身份 | span、trace、log、事件 |
| **数据库模型** | 行式关系型（SQLite 兼容） | 嵌入式列式分析型 |
| **读写模式** | 高频随机读写、按主键/索引查询 | 批量追加写、按时间范围分析查询 |
| **本地文件** | `mastra.db` | `mastra.duckdb` |
| **托管切换** | 支持 Turso | 当前仅本地 + Platform 上报 |
| **Mastra domain** | `default` | `observability` |
| **失败影响** | 影响对话记忆、消息存储 | 仅影响诊断与可观测性，不影响业务功能 |
| **数据保留策略** | 长期保留用户会话 | 可定期清理或归档，控制磁盘增长 |

### 4.4.5 `MastraCompositeStore` 如何路由

`src/mastra/index.ts` 中的配置明确按 domain 拆分：

```typescript
storage: new MastraCompositeStore({
  id: 'composite-storage',
  default: new LibSQLStore({
    id: "mastra-storage",
    url: process.env.TURSO_DATABASE_URL ?? "file:./mastra.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
  domains: {
    observability: await new DuckDBStore().getStore('observability'),
  }
})
```

- `default`：未指定 domain 的 Mastra 存储请求（如 Memory、Thread、Message）默认路由到 LibSQL。
- `domains.observability`：可观测性组件明确请求 `observability` domain，路由到 DuckDB。

这种设计的好处：

1. **关注点分离**：应用逻辑与诊断数据在存储层解耦。
2. **独立扩展**：未来可以单独对 LibSQL 做高可用（Turso），对 DuckDB 做归档策略。
3. **故障隔离**：可观测性存储异常不会导致聊天功能不可用。
4. **开发简洁**：本地仍然只需要两个文件（`mastra.db` + `mastra.duckdb`），无需启动独立数据库服务。

### 4.4.6 文件清单与运行时行为

| 文件 | 数据库 | 生成时机 | 是否提交 Git |
| --- | --- | --- | --- |
| `mastra.db` | LibSQL | 首次启动后端 | 否（已在 `.gitignore`） |
| `mastra.db-shm` | LibSQL WAL | 运行时 | 否 |
| `mastra.db-wal` | LibSQL WAL | 运行时 | 否 |
| `mastra.duckdb` | DuckDB | 首次产生可观测性事件 | 否（已在 `.gitignore`） |
| `mastra.duckdb.wal` | DuckDB WAL | 运行时 | 否 |

> 注意：这些运行时数据文件均为本地生成，**不应提交到版本库**。
>
> 更详细的存储引擎设计与对比，见 [存储系统设计](./storage-system.md)。

## 5. 数据生命周期

### 5.1 会话生命周期

1. **创建**：`createSession` 在活动项目下创建空会话，`agentType` 继承自项目。
2. **活跃**：用户发送消息，标题从首条用户消息派生；`updatedAt` 刷新。
3. **切换**：`switchSession` 只改 `activeSessionId`；首次进入时以本地快照覆盖 agent 消息（hydration）。
4. **删除**：`deleteSession` 移除会话；若删除的是当前会话，优先切到同项目最近更新的会话，否则新建空会话。

### 5.2 项目生命周期

1. **创建**：`createProject` 创建项目并在其中创建空会话，激活新项目/新会话。
2. **重命名**：更新 `name` 与 `updatedAt`。
3. **删除**：`deleteProject` 将项目下所有会话的 `projectId` 置为 `null`（变为未分类）；会话本身与其中消息保留。

### 5.3 数据迁移

- v1 数据（无 `agentType`）加载时，`migrateWorkspace` 为所有 Project 和 Session 补上 `"weather"` 类型。
- v2 是当前版本；v3 及未知版本会被拒绝。

## 6. 数据安全与隐私

| 风险 | 策略 | 位置 |
| --- | --- | --- |
| API Key 泄露 | `.env` 管理，`.gitignore` 排除提交 | `.env.example` |
| 敏感信息进入可观测性 | `SensitiveDataFilter` 对 span 输出脱敏 | `src/mastra/index.ts` |
| localStorage _quota 超限 | 图片降级为文本占位符 | `sanitizeMessagesForStorage` |
| 请求体过大 | Express 限制 20mb + `ToolResultTrimmer` 压缩历史 HTML | `src/index.ts`、`src/mastra/processors/tool-result-trimmer.ts` |
| 服务端记忆连续性 | `x-mastra-resource-id` 头关联资源身份 | `src/index.ts`、`src/client/main.tsx` |

## 7. 数据一致性要点

- **前端快照 vs 后端记忆**：本地 `messages` 是快照，后端 Mastra Memory 才是权威对话上下文。二者通过 `reconcileSessionMessages` 同步：
  - 首次进入会话：以快照覆盖 agent（hydrate）。
  - 之后：若 agent 侧更新则保存快照；若相同则保持同步；agent 为空则恢复快照。
- **图片占位一致性**：比较前对 agent 侧消息也做 `sanitizeMessagesForStorage`，避免带图会话陷入“保存-渲染”循环。
- **会话删除不丢消息**：删除项目仅解除归属，会话仍可在“未分类”或“全部历史”中查看和继续。
