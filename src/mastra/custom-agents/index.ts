import { createClient, type Client } from '@libsql/client';
import type { Mastra } from '@mastra/core/mastra';
import type { WorkflowGraph } from '../../shared/workflow-dsl';
import { createCustomAgentsRouter } from './api';
import { compileWorkflow } from './compile';
import { createCustomAgentRegistry, type CustomAgentRegistry } from './registry';
import { createCustomAgentsService, type CustomAgentsService } from './service';
import { ensureCustomAgentsTable, getCustomAgent, listCustomAgents } from './store';
import { getToolNames } from './tool-registry';
import { WorkflowAgent, type CompiledWorkflowHandle } from './workflow-agent';

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

// 运行期注册表需在 Mastra 实例存在后创建（compile 与 addAgent 都要用它）。
// Workflow 是 thenable（.then 是构建方法），编译结果一律包一层 { workflow } 传递，绝不被 await 收养。
export function createRegistryFor(mastra: Mastra, client: Client): CustomAgentRegistry {
  return createCustomAgentRegistry({
    listSummaries: (resourceId) => listCustomAgents(client, resourceId),
    loadDefinition: async (id, resourceId) => {
      const row = await getCustomAgent(client, id, resourceId);
      return row ? { id: row.id, name: row.name, graph: row.graph } : null;
    },
    registerAgent: (key, agent) => {
      mastra.addAgent(agent as never, key);
      return true;
    },
    removeAgent: (key) => mastra.removeAgent(key),
    compileGraph: async (graph: WorkflowGraph) => ({
      workflow: compileWorkflow(graph, { mastra }) as unknown as CompiledWorkflowHandle,
    }),
    agentFactory: (definition, workflow) =>
      new WorkflowAgent({ definition, workflow }),
  });
}
