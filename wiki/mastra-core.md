# Mastra 核心（Mastra Core）

> C4 层级：**C3 Component**（Mastra 容器内的核心编排组件）。

## 1. 职责

`src/mastra/index.ts` 负责组装整个 Mastra 运行时，包括：

1. 注册所有 Agent、Workflow。
2. 配置复合存储（应用数据用 LibSQL，可观测性数据用 DuckDB）。
3. 配置日志与可观测性（Pino + Exporters + 敏感数据过滤）。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/mastra/index.ts` | Mastra 实例定义与全局配置 |
| `src/mastra/agents/index.ts` | Agent 注册表 |
| `src/mastra/workflows/weather-workflow.ts` | 注册的工作流 |

## 3. 关键类 / 函数

| 名称 | 来源 | 作用 |
| --- | --- | --- |
| `Mastra` | `@mastra/core/mastra` | 运行时核心，统一管理 agents/workflows/storage/logger/observability |
| `MastraCompositeStore` | `@mastra/core/storage` | 按 domain 组合多个存储后端 |
| `LibSQLStore` | `@mastra/libsql` | 应用数据持久化（线程、消息、记忆） |
| `DuckDBStore` | `@mastra/duckdb` | 可观测性数据持久化 |
| `PinoLogger` | `@mastra/loggers` | 结构化日志 |
| `Observability` | `@mastra/observability` | 可观测性配置 |
| `MastraStorageExporter` | `@mastra/observability` | 将可观测性事件写入 Mastra Storage |
| `MastraPlatformExporter` | `@mastra/observability` | 将可观测性事件上报 Mastra Platform |
| `SensitiveDataFilter` | `@mastra/observability` | 脱敏 span 输出中的密码、token、key |

## 4. 调用关系

```text
backend-entry.ts
    │
    ▼
MastraServer.init()
    │
    ▼
new Mastra({ agents, workflows, storage, logger, observability })
    │
    ├──────▶ agents { weatherAgent, generalAgent, activityPlannerAgent }
    ├──────▶ workflows { weatherWorkflow }
    ├──────▶ MastraCompositeStore
    │          ├── default: LibSQLStore (mastra.db / Turso)
    │          └── observability: DuckDBStore
    ├──────▶ PinoLogger
    └──────▶ Observability
               ├── MastraStorageExporter
               ├── MastraPlatformExporter
               └── SensitiveDataFilter
```

## 5. C4 Code 关键代码

```typescript
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { agents } from './agents';

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents,
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
  }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(),
          new MastraPlatformExporter(),
        ],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
```

## 6. 设计要点

- **复合存储**：应用数据与可观测性数据写入不同存储引擎，避免互相影响。
- **环境驱动**：通过 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` 可在部署时切换到托管 Turso。
- **安全默认**：`SensitiveDataFilter` 作为 span 输出处理器，防止 API key、密码等敏感信息泄露到可观测性数据。
- **agents 注册表**：`src/mastra/agents/index.ts` 导出 `{ weatherAgent, generalAgent, activityPlannerAgent }`，必须在此处集中注册。
