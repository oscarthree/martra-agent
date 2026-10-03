# 存储系统设计（Storage System）

> 技术横切关注点（Cross-Cutting Concern）。持久化能力被前端工作区、Mastra 运行时、可观测性管道、记忆系统等多个模块共同依赖，因此作为横切关注点统一设计。

## 1. 为什么是横切关注点

在 Weather Copilot 中，存储不是某个单一模块的职责：

| 使用方 | 依赖的存储 | 用途 |
| --- | --- | --- |
| 前端 `workspace-state.ts` | `localStorage` | 工作区、项目、会话、消息快照 |
| Mastra Memory | LibSQL | 线程、消息、资源身份 |
| Mastra Storage | LibSQL | 工作流状态、评估结果等运行时状态 |
| 可观测性管道 | DuckDB | span、trace、log |

这些存储需求在调用链上贯穿前端、后端、AI 框架与诊断系统，因此将 LibSQL 与 DuckDB 的设计作为横切关注点独立成文。

## 2. 存储分层总览

```text
┌─────────────────────────────────────────────────────────────┐
│                         浏览器前端                             │
│  localStorage                                               │
│  ├── weather-copilot-workspace-v1  (WorkspaceState JSON)    │
│  └── mastra-resource-id            (UUID)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP /api/copilotkit
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         后端服务                               │
│                                                             │
│   MastraCompositeStore                                      │
│   ├── default domain ────────▶ LibSQLStore                  │
│   │                            (应用数据：thread/message/    │
│   │                             resourceId/workflow state)   │
│   │                                                          │
│   └── observability domain ──▶ DuckDBStore                  │
│                                (可观测性数据：span/trace/log)  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 3. LibSQL：应用数据存储

### 3.1 角色

LibSQL 是 Weather Copilot 的**应用主数据库**，承载 Mastra 运行时的核心状态数据。

### 3.2 存储内容

| 数据 | 说明 |
| --- | --- |
| Thread | 对话线程，对应前端一个 session |
| Message | 单条对话消息，含 role、content、tool-invocation 等 |
| Resource Identity | `resourceId` 与 thread 的归属关系 |
| Memory Context | 语义记忆、召回向量（若启用） |
| Workflow State | 工作流执行状态（如有） |
| Evals/Traces | 评估结果（若使用） |

### 3.3 技术特征

| 维度 | 说明 |
| --- | --- |
| 数据库类型 | SQLite 兼容的嵌入式关系型数据库 |
| 本地文件 | `mastra.db` |
| 托管方案 | Turso（分布式 LibSQL） |
| 访问库 | `@mastra/libsql` 的 `LibSQLStore` |
| 数据模型 | 行式、结构化、支持 SQL 事务 |
| 读写特征 | 高频随机读写、按 `threadId`/`resourceId` 索引查询 |

### 3.4 本地与部署形态

```typescript
new LibSQLStore({
  id: "mastra-storage",
  url: process.env.TURSO_DATABASE_URL ?? "file:./mastra.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
})
```

- **开发**：`mastra.db` 本地文件，零配置启动。
- **部署**：设置 `TURSO_DATABASE_URL` 与 `TURSO_AUTH_TOKEN` 即可切换到 Turso 托管数据库，无需改代码。

### 3.5 为什么选 LibSQL

1. **SQLite 生态兼容**：本地开发简单，一个文件即可运行。
2. **托管平滑迁移**：Turso 提供分布式、多副本、边缘部署能力。
3. **Mastra 原生支持**：`@mastra/libsql` 提供开箱即用的 `LibSQLStore`。
4. **事务性记忆**：关系型模型适合 thread/message 的精确读写与一致性要求。

## 4. DuckDB：可观测性数据存储

### 4.1 角色

DuckDB 是 Weather Copilot 的**可观测性专用数据库**，专门存放诊断与分析型数据。

### 4.2 存储内容

| 数据 | 说明 |
| --- | --- |
| Span | LLM 调用、工具调用、工作流步骤的 span |
| Trace | 一次用户请求的完整调用链 |
| Log | Pino 结构化日志 |
| Metric | 延迟、token 用量等性能指标（若启用） |

### 4.3 技术特征

| 维度 | 说明 |
| --- | --- |
| 数据库类型 | 嵌入式列式分析型数据库 |
| 本地文件 | `mastra.duckdb` |
| 访问库 | `@mastra/duckdb` 的 `DuckDBStore` |
| 数据模型 | 列式、适合批量追加与时间范围分析 |
| 读写特征 | 写多读少、按时间范围聚合查询 |

### 4.4 写入路径

```text
Mastra Observability
    │
    ├── MastraStorageExporter ──▶ DuckDBStore (mastra.duckdb)
    │
    └── MastraPlatformExporter ──▶ Mastra Platform (可选，需 MASTRA_PLATFORM_ACCESS_TOKEN)
```

- 默认本地持久化到 `mastra.duckdb`。
- 设置 `MASTRA_PLATFORM_ACCESS_TOKEN` 后，可同时上报到 Mastra Platform 做云端分析。

### 4.5 为什么选 DuckDB

1. **分析型查询高效**：列式存储对 span/trace 的时间范围聚合、过滤远超行式数据库。
2. **嵌入式部署**：与 LibSQL 一样本地文件即可运行，不依赖外部服务。
3. **与可观测性数据特征匹配**：写多读少、数据量大、需要按时间段扫描。
4. **独立生命周期**：可单独清理、归档，不影响应用数据库。

## 5. LibSQL 与 DuckDB 对比

| 对比维度 | LibSQL | DuckDB |
| --- | --- | --- |
| **主要职责** | 应用数据持久化 | 可观测性数据持久化 |
| **数据类型** | thread、message、memory、resourceId、workflow state | span、trace、log、metric |
| **数据库模型** | 行式关系型（SQLite 兼容） | 嵌入式列式分析型 |
| **本地文件** | `mastra.db` | `mastra.duckdb` |
| **托管方案** | Turso | 当前仅本地 + Mastra Platform 上报 |
| **Mastra domain** | `default` | `observability` |
| **读写模式** | 高频随机读写、按主键/索引查询 | 批量追加写、按时间范围分析查询 |
| **一致性要求** | 高（不能丢消息） | 中（允许少量丢失） |
| **失败影响** | 影响聊天记忆、消息存储 | 仅影响诊断，不影响业务功能 |
| **数据保留策略** | 长期保留 | 可定期清理或归档 |

## 6. MastraCompositeStore 路由机制

`src/mastra/index.ts` 通过 `MastraCompositeStore` 将两类数据路由到不同引擎：

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

| 配置项 | 含义 |
| --- | --- |
| `default` | 未显式指定 domain 的存储请求默认走 LibSQL |
| `domains.observability` | 可观测性组件显式使用 `observability` domain，走 DuckDB |

### 6.1 路由示例

```text
Mastra Memory.save({ threadId, messages })
    │
    └── 未指定 domain ──▶ default ──▶ LibSQLStore ──▶ mastra.db

Observability.recordSpan(span)
    │
    └── 指定 domain = observability ──▶ DuckDBStore ──▶ mastra.duckdb
```

## 7. 运行时文件清单

| 文件 | 数据库 | 生成时机 | 是否提交 Git |
| --- | --- | --- | --- |
| `mastra.db` | LibSQL | 首次启动后端 | 否 |
| `mastra.db-shm` | LibSQL WAL | 运行时 | 否 |
| `mastra.db-wal` | LibSQL WAL | 运行时 | 否 |
| `mastra.duckdb` | DuckDB | 首次产生可观测性事件 | 否 |
| `mastra.duckdb.wal` | DuckDB WAL | 运行时 | 否 |

> 所有运行时数据文件均已加入 `.gitignore`，**不应提交到版本库**。

## 8. 生产环境：使用 MySQL 替换 LibSQL

### 8.1 目标

- **开发环境**继续使用 LibSQL（本地文件 `mastra.db`），零依赖、启动快。
- **生产环境**切换到 MySQL，利用成熟的运维、备份、监控、高可用能力。
- 两者通过**统一的存储适配器**无缝切换，业务代码无需感知底层数据库差异。

### 8.2 适配器设计

引入一个抽象的 **AppStorageAdapter**，封装 Mastra Storage 接口，底层可接入 LibSQL 或 MySQL：

```text
┌─────────────────────────────────────────┐
│         MastraCompositeStore            │
│         default domain                  │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────┐
│   AppStorageAdapter         │
│   (统一 Storage 接口)        │
└───────┬─────────────────────┘
        │
   ┌────┴────┐
   ▼         ▼
LibSQL    MySQL
(本地)   (生产)
```

### 8.3 切换方式

通过环境变量控制：

```text
# 开发（默认）
APP_STORAGE_PROVIDER=libsql
LIBSQL_URL=file:./mastra.db

# 生产
APP_STORAGE_PROVIDER=mysql
MYSQL_HOST=mysql.example.com
MYSQL_PORT=3306
MYSQL_DATABASE=weather_copilot
MYSQL_USER=wc_user
MYSQL_PASSWORD=***
```

在 `src/mastra/index.ts` 中：

```typescript
function createAppStorage() {
  const provider = process.env.APP_STORAGE_PROVIDER ?? "libsql";

  if (provider === "mysql") {
    return new MySQLStore({
      host: process.env.MYSQL_HOST!,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      database: process.env.MYSQL_DATABASE!,
      user: process.env.MYSQL_USER!,
      password: process.env.MYSQL_PASSWORD!,
      // 连接池、SSL、时区等配置
    });
  }

  return new LibSQLStore({
    id: "mastra-storage",
    url: process.env.TURSO_DATABASE_URL ?? "file:./mastra.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}
```

### 8.4 需要处理的问题

| 问题 | 策略 |
| --- | --- |
| **Schema 差异** | 统一抽象层屏蔽底层 SQL 方言；使用兼容 SQL 的子集（如标准 DDL、参数化查询） |
| **连接池** | MySQL 需要配置连接池；LibSQL 本地文件可视为单连接 |
| **事务** | 抽象层统一暴露 `transaction()` / `begin/commit/rollback` |
| **迁移脚本** | 提供基于环境的数据库初始化/迁移脚本，支持 LibSQL 与 MySQL 两种目标 |
| **数据导出导入** | 上线前需将 LibSQL 中的 thread/message 数据迁移到 MySQL |
| **ID 生成** | 继续使用 UUID，避免不同数据库自增 ID 冲突 |

### 8.5 对现有代码的影响

- `src/mastra/index.ts`：将 `LibSQLStore` 替换为 `createAppStorage()`。
- `src/mastra/agents/shared.ts` 与记忆系统：无需改动，仍通过 Mastra Memory 访问 Storage。
- 业务代码（Agent/Tool/Workflow）：完全无感知。
- 测试：保留 LibSQL 作为测试数据库，保证 CI 快速稳定。

### 8.6 为什么不直接用 Turso

Turso 是 LibSQL 的托管方案，切换成本最低。但如果团队已有 MySQL 运维体系、需要复用现有监控备份策略、或需要更复杂的关系型查询，MySQL 是更自然的选择。适配器设计让两种方案并存，未来也可扩展至 PostgreSQL 等其他引擎。

## 9. 设计要点

1. **关注点分离**：应用数据与可观测性数据在存储引擎层完全解耦，避免互相争抢资源。
2. **开发简洁**：本地均使用文件型数据库，无需启动独立数据库服务。
3. **部署可扩展**：LibSQL 可平滑切换到 Turso；通过 `AppStorageAdapter` 可进一步切换到 MySQL。
4. **故障隔离**：可观测性存储异常不会导致聊天功能不可用。
5. **环境驱动切换**：通过环境变量而非代码改动切换本地/托管/生产存储。
