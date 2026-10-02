import { describe, expect, it } from 'vitest';
import { createCustomAgentRegistry } from './registry';

// 内存假件：定义存储 + 注册表 + 编译器
function makeFakes() {
  const rows = new Map<string, { id: string; name: string; graph: string; resourceId: string; updatedAt: number }>();
  const registered = new Map<string, unknown>();
  const compileLog: Array<{ id: string; graph: string }> = [];
  const removeLog: string[] = [];

  const deps = {
    listSummaries: async (resourceId: string) =>
      [...rows.values()]
        .filter((row) => row.resourceId === resourceId)
        .map(({ id, updatedAt }) => ({ id, updatedAt })),
    loadDefinition: async (id: string, resourceId: string) => {
      const row = rows.get(`${resourceId}:${id}`);
      return row ? { id: row.id, name: row.name, graph: row.graph } : null;
    },
    registerAgent: (key: string, agent: unknown) => {
      if (registered.has(key)) return false; // 与 mastra.addAgent 同 key 跳过语义一致
      registered.set(key, agent);
      return true;
    },
    removeAgent: (key: string) => {
      removeLog.push(key);
      return registered.delete(key);
    },
    compileGraph: async (graph: unknown) => {
      const id = (graph as { defId?: string }).defId ?? 'unknown';
      compileLog.push({ id, graph: JSON.stringify(graph) });
      return {
        workflow: {
          __registerMastra: () => {},
          createRun: async () => ({ start: async () => ({ status: 'success', result: id }) }),
        },
      };
    },
    agentFactory: (definition: { id: string; name: string }, workflow: unknown) => ({
      definition,
      workflow,
    }),
  };

  return { rows, registered, compileLog, removeLog, deps };
}


function seed(rows: Map<string, { id: string; name: string; graph: string; resourceId: string; updatedAt: number }>, id: string, resourceId: string, updatedAt: number) {
  rows.set(`${resourceId}:${id}`, {
    id,
    name: `助手${id}`,
    graph: JSON.stringify({ defId: `${id}-graph`, version: 1 }),
    resourceId,
    updatedAt,
  });
}

describe('createCustomAgentRegistry', () => {
  it('ensure 加载定义并注册 custom-<id> agent，重复 ensure 幂等', async () => {
    const f = makeFakes();
    seed(f.rows, 'd1', 'r1', 100);
    const registry = createCustomAgentRegistry(f.deps);

    await registry.ensureAgentsForResource('r1');
    expect(f.registered.has('custom-d1')).toBe(true);
    expect(f.compileLog).toHaveLength(1);

    await registry.ensureAgentsForResource('r1');
    expect(f.compileLog).toHaveLength(1); // updatedAt 未变，不重复编译
  });

  it('updatedAt 变化时重编译并重注册（先移除旧 key）', async () => {
    const f = makeFakes();
    seed(f.rows, 'd1', 'r1', 100);
    const registry = createCustomAgentRegistry(f.deps);

    await registry.ensureAgentsForResource('r1');
    seed(f.rows, 'd1', 'r1', 200);
    await registry.ensureAgentsForResource('r1');

    expect(f.compileLog).toHaveLength(2);
    expect(f.removeLog).toEqual(['custom-d1']);
    expect(f.registered.has('custom-d1')).toBe(true);
  });

  it('按 resource 隔离；已删除的定义不再 ensure 但保持已注册实例', async () => {
    const f = makeFakes();
    seed(f.rows, 'd1', 'r1', 100);
    const registry = createCustomAgentRegistry(f.deps);

    await registry.ensureAgentsForResource('r1');
    expect(f.registered.size).toBe(1);

    await registry.ensureAgentsForResource('r2');
    expect(f.registered.size).toBe(1); // r2 无定义

    f.rows.delete('r1:d1'); // 定义被删除
    await registry.ensureAgentsForResource('r1');
    expect(f.compileLog).toHaveLength(1); // 不再加载/编译
    expect(f.registered.has('custom-d1')).toBe(true); // 实例保留（会话侧有错误态拦截）
  });

  it('加载过程中新出现的定义在下一次 ensure 时注册', async () => {
    const f = makeFakes();
    seed(f.rows, 'd1', 'r1', 100);
    const registry = createCustomAgentRegistry(f.deps);
    await registry.ensureAgentsForResource('r1');

    seed(f.rows, 'd2', 'r1', 100);
    await registry.ensureAgentsForResource('r1');
    expect(f.registered.has('custom-d2')).toBe(true);
    expect(f.compileLog).toHaveLength(2);
  });

  it('单个定义损坏不影响同 resource 其他定义注册', async () => {
    const f = makeFakes();
    seed(f.rows, 'bad', 'r1', 100);
    seed(f.rows, 'good', 'r1', 100);
    const failingCompile = async (graph: unknown) => {
      const id = (graph as { defId?: string }).defId ?? 'unknown';
      if (id === 'bad-graph') throw new Error('graph broken');
      return f.deps.compileGraph(graph);
    };
    const registry = createCustomAgentRegistry({ ...f.deps, compileGraph: failingCompile });

    await registry.ensureAgentsForResource('r1');
    expect(f.registered.has('custom-good')).toBe(true);
    expect(f.registered.has('custom-bad')).toBe(false);
  });
});
