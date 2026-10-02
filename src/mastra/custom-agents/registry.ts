import type { WorkflowGraph } from '../../shared/workflow-dsl';
import type { CompiledWorkflowHandle, WorkflowAgentDefinition } from './workflow-agent';

// ensure-registered：CopilotKit 每请求现场枚举 agents（src/index.ts 函数形式），
// 枚举前对本 resource 的定义逐一 ensure——新定义编译注册、updatedAt 变化重编译重注册、
// 未变化跳过（同 key 注册被 mastra 静默跳过，所以重注册要先移除）。
// 已删除的定义不再出现 ensure 里；已注册实例保留（会话侧有错误态拦截）。

export const customAgentKey = (definitionId: string) => `custom-${definitionId}`;

export interface CustomAgentRegistryDeps {
  listSummaries: (resourceId: string) => Promise<Array<{ id: string; updatedAt: number }>>;
  loadDefinition: (
    id: string,
    resourceId: string,
  ) => Promise<{ id: string; name: string; graph: string } | null>;
  registerAgent: (key: string, agent: unknown) => boolean;
  removeAgent: (key: string) => boolean;
  // 注意：Workflow 有 .then 链式构建方法，是 thenable——绝不能被 await/Promise.resolve 直接收养，
  // 所以编译结果必须包一层对象传递。
  compileGraph: (graph: WorkflowGraph) => Promise<{ workflow: CompiledWorkflowHandle }>;
  agentFactory: (definition: WorkflowAgentDefinition, workflow: CompiledWorkflowHandle) => unknown;
}

export interface CustomAgentRegistry {
  ensureAgentsForResource(resourceId: string): Promise<void>;
}

export function createCustomAgentRegistry(deps: CustomAgentRegistryDeps): CustomAgentRegistry {
  // 编译缓存：definitionId → 已注册版本
  const cache = new Map<string, number>();

  return {
    async ensureAgentsForResource(resourceId) {
      const summaries = await deps.listSummaries(resourceId);
      for (const summary of summaries) {
        const cached = cache.get(summary.id);
        if (cached === summary.updatedAt) continue;

        try {
          const definition = await deps.loadDefinition(summary.id, resourceId);
          if (!definition) continue;

          const graph = JSON.parse(definition.graph) as WorkflowGraph;
          const { workflow } = await deps.compileGraph(graph);
          const agent = deps.agentFactory({ id: definition.id, name: definition.name }, workflow);

          const key = customAgentKey(definition.id);
          // 同 key 注册被 mastra 静默跳过，重注册（已注册过版本）先移除旧 key
          if (cached !== undefined) {
            deps.removeAgent(key);
          }
          deps.registerAgent(key, agent);
          cache.set(summary.id, summary.updatedAt);
        } catch (error) {
          // 单个定义坏了不应拖垮整个 resource 的 agents 枚举
          console.error(`custom agent ${summary.id} ensure failed:`, error);
        }
      }
    },
  };
}
