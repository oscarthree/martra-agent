
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { agents } from './agents';
import { createCustomAgentsModule, createRegistryFor } from './custom-agents';

export const customAgents = await createCustomAgentsModule();

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents,
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: "mastra-storage",
      // Uses a hosted database when deployed (mastra env db create --kind turso),
      // and a local file during development.
      url: process.env.TURSO_DATABASE_URL ?? "file:./mastra.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
    domains: {
      observability: await new DuckDBStore({
        // 可用 MASTRA_DUCKDB_PATH 覆盖（如 ':memory:' 或临时路径），便于多实例开发/测试
        path: process.env.MASTRA_DUCKDB_PATH ?? 'mastra.duckdb',
      }).getStore('observability'),
    }
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});

// 自定义 Agent 运行期注册表：CopilotKit 每请求枚举 agents 前对本 resource ensure
// （新定义编译注册、updatedAt 变化重编译重注册）。
export const customAgentRegistry = createRegistryFor(mastra, customAgents.client);
