import { createClient, type Client } from '@libsql/client';
import { createCustomAgentsRouter } from './api';
import { createCustomAgentsService, type CustomAgentsService } from './service';
import { ensureCustomAgentsTable } from './store';
import { getToolNames } from './tool-registry';

// custom-agents 模块组装：与 Mastra 存储读同一组环境变量，但走独立应用表。

export interface CustomAgentsModule {
  client: Client;
  service: CustomAgentsService;
  router: ReturnType<typeof createCustomAgentsRouter>;
}

export async function createCustomAgentsModule(): Promise<CustomAgentsModule> {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  await ensureCustomAgentsTable(client);
  const service = createCustomAgentsService({ client, toolNames: getToolNames() });
  return { client, service, router: createCustomAgentsRouter(service) };
}
