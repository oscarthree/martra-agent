import { Mastra } from '@mastra/core/mastra';
import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '../../shared/workflow-dsl';
import {
  branchConditionFor,
  compileWorkflow,
  type WorkflowInit,
} from './compile';
import type { ConditionBranch } from '../../shared/workflow-dsl';

// 假工具：替代真实注册表，避免网络与模型调用
const echoTool = createTool({
  id: 'echo-tool',
  description: '测试回声工具',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ echoed: z.string() }),
  execute: async ({ text }) => ({ echoed: `echo:${text}` }),
});

const failingTool = createTool({
  id: 'failing-tool',
  description: '总是失败的工具',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => {
    throw new Error('boom');
  },
});

const fakeTools: ReadonlyMap<string, Tool> = new Map<string, Tool>([
  [echoTool.id, echoTool as unknown as Tool],
  [failingTool.id, failingTool as unknown as Tool],
]);

const pos = { x: 0, y: 0 };

function start(id: string) {
  return { id, type: 'start' as const, position: pos, data: {} };
}
function end(id: string, output: string) {
  return { id, type: 'end' as const, position: pos, data: { output } };
}
function tool(id: string, toolName: string, args: Record<string, unknown> = {}) {
  return { id, type: 'tool' as const, position: pos, data: { toolName, args } };
}
function cond(id: string, branches: ConditionBranch[]) {
  return { id, type: 'condition' as const, position: pos, data: { branches } };
}
function edge(id: string, source: string, target: string, sourceHandle?: string) {
  return sourceHandle === undefined
    ? { id, source, target }
    : { id, source, target, sourceHandle };
}

function graphOf(nodes: WorkflowGraph['nodes'], edges: WorkflowGraph['edges']): WorkflowGraph {
  return { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges };
}

function initOf(userMessage: string): WorkflowInit {
  return { userMessage, threadId: 't-1', resourceId: 'r-1' };
}

async function runGraph(graph: WorkflowGraph, init: WorkflowInit) {
  const mastra = new Mastra({});
  const workflow = compileWorkflow(graph, { mastra, tools: fakeTools });
  const run = await workflow.createRun();
  return run.start({ inputData: init });
}

describe('branchConditionFor — 取反链短路语义', () => {
  const branches: ConditionBranch[] = [
    { id: 'b1', expression: { left: '{{n1.output}}', op: 'equals', right: 'A' } },
    { id: 'b2', expression: { left: '{{n1.output}}', op: 'equals', right: 'B' } },
    { id: 'b3' },
  ];

  function paramsWith(outputs: Record<string, string>) {
    return { getStepResult: (id: string) => outputs[id] } as never;
  }

  it('第一个分支命中时只有它的条件为 true', async () => {
    const p = paramsWith({ n1: 'A' });
    expect(await branchConditionFor(branches, 0)(p)).toBe(true);
    expect(await branchConditionFor(branches, 1)(p)).toBe(false);
    expect(await branchConditionFor(branches, 2)(p)).toBe(false);
  });

  it('多个表达式同时成立时只有最前者命中（互斥短路）', async () => {
    const bothTrue: ConditionBranch[] = [
      { id: 'b1', expression: { left: '{{n1.output}}', op: 'notEmpty', right: '' } },
      { id: 'b2', expression: { left: '{{n1.output}}', op: 'contains', right: 'x' } },
    ];
    const p = paramsWith({ n1: 'xyz' });
    expect(await branchConditionFor(bothTrue, 0)(p)).toBe(true);
    expect(await branchConditionFor(bothTrue, 1)(p)).toBe(false);
  });

  it('兜底分支只在前面都不成立时命中', async () => {
    const p = paramsWith({ n1: 'zzz' });
    expect(await branchConditionFor(branches, 0)(p)).toBe(false);
    expect(await branchConditionFor(branches, 1)(p)).toBe(false);
    expect(await branchConditionFor(branches, 2)(p)).toBe(true);
  });

  it('表达式抛错按 false 处理，兜底分支仍命中', async () => {
    const throwing: ConditionBranch[] = [
      { id: 'b1', expression: { left: '{{n1.output}}', op: 'equals', right: 'A' } },
      { id: 'b2' },
    ];
    const p = {
      getStepResult: () => {
        throw new Error('eval boom');
      },
    } as never;
    expect(await branchConditionFor(throwing, 0)(p)).toBe(false);
    expect(await branchConditionFor(throwing, 1)(p)).toBe(true);
  });
});

describe('compileWorkflow', () => {
  it('编译 start → end 并可用真实引擎执行', async () => {
    const graph = graphOf(
      [start('s1'), end('e1', '收到：{{s1.output}}')],
      [edge('x1', 's1', 'e1')],
    );
    const result = await runGraph(graph, initOf('你好'));
    expect(result.status).toBe('success');
    const text = (result as { result: unknown }).result;
    expect(text).toBe('收到：你好');
  });

  it('工具节点调用注册表工具并整体 JSON 化输出', async () => {
    const graph = graphOf(
      [start('s1'), tool('t1', 'echo-tool', { text: '{{s1.output}}' }), end('e1', '{{t1.output}}')],
      [edge('x1', 's1', 't1'), edge('x2', 't1', 'e1')],
    );
    const result = await runGraph(graph, initOf('天气'));
    expect(result.status).toBe('success');
    expect((result as { result: string }).result).toBe(JSON.stringify({ echoed: 'echo:天气' }));
  });

  it('工具 ok:false 之外未捕获的异常使 workflow failed', async () => {
    const graph = graphOf(
      [start('s1'), tool('t1', 'failing-tool'), end('e1', '{{t1.output}}')],
      [edge('x1', 's1', 't1'), edge('x2', 't1', 'e1')],
    );
    const result = await runGraph(graph, initOf('x'));
    expect(result.status).toBe('failed');
  });

  it('条件节点走 .branch 取反链：命中分支执行、兜底分支短路', async () => {
    const graph = graphOf(
      [
        start('s1'),
        cond('c1', [
          { id: 'b1', expression: { left: '{{s1.output}}', op: 'equals', right: 'go' } },
          { id: 'b2' },
        ]),
        end('e1', '分支一'),
        end('e2', '兜底：{{s1.output}}'),
      ],
      [
        edge('x1', 's1', 'c1'),
        edge('x2', 'c1', 'e1', 'b1'),
        edge('x3', 'c1', 'e2', 'b2'),
      ],
    );
    const hit = await runGraph(graph, initOf('go'));
    expect(hit.status).toBe('success');
    expect(Object.values((hit as { result: Record<string, string> }).result)[0]).toBe('分支一');

    const miss = await runGraph(graph, initOf('stop'));
    expect(miss.status).toBe('success');
    expect(Object.values((miss as { result: Record<string, string> }).result)[0]).toBe('兜底：stop');
  });

  it('分支内多节点链与分支后汇聚都能执行', async () => {
    const graph = graphOf(
      [
        start('s1'),
        cond('c1', [
          { id: 'b1', expression: { left: '{{s1.output}}', op: 'equals', right: 'go' } },
          { id: 'b2' },
        ]),
        tool('t1', 'echo-tool', { text: 'A' }),
        tool('t2', 'echo-tool', { text: 'B' }),
        end('e1', '合并：{{t1.output}}|{{t2.output}}'),
      ],
      [
        edge('x1', 's1', 'c1'),
        edge('x2', 'c1', 't1', 'b1'),
        edge('x3', 'c1', 't2', 'b2'),
        edge('x4', 't1', 'e1'),
        edge('x5', 't2', 'e1'),
      ],
    );
    const hit = await runGraph(graph, initOf('go'));
    expect(hit.status).toBe('success');
    expect((hit as { result: string }).result).toContain('echo:A');

    const miss = await runGraph(graph, initOf('stop'));
    expect(miss.status).toBe('success');
    expect((miss as { result: string }).result).toContain('echo:B');
  });

  it('单节点分支链到 end 同样渲染 end 模板', async () => {
    const graph = graphOf(
      [
        start('s1'),
        cond('c1', [
          { id: 'b1', expression: { left: '{{s1.output}}', op: 'equals', right: 'go' } },
          { id: 'b2' },
        ]),
        tool('t1', 'echo-tool', { text: 'A' }),
        end('e1', '结果：{{t1.output}}'),
        end('e2', '兜底'),
      ],
      [
        edge('x1', 's1', 'c1'),
        edge('x2', 'c1', 't1', 'b1'),
        edge('x3', 'c1', 'e2', 'b2'),
        edge('x4', 't1', 'e1'),
      ],
    );
    const hit = await runGraph(graph, initOf('go'));
    expect(hit.status).toBe('success');
    expect(Object.values((hit as { result: Record<string, string> }).result)[0]).toBe(
      `结果：${JSON.stringify({ echoed: 'echo:A' })}`,
    );
  });

  it('拒绝非条件节点的多出边', async () => {
    const graph = graphOf(
      [start('s1'), tool('t1', 'echo-tool'), end('e1', ''), end('e2', '')],
      [edge('x1', 's1', 't1'), edge('x2', 't1', 'e1'), edge('x3', 't1', 'e2')],
    );
    await expect(runGraph(graph, initOf('x'))).rejects.toThrow('多条出边');
  });

  it('拒绝执行不到结束节点的悬空链', async () => {
    const graph = graphOf(
      [start('s1'), tool('t1', 'echo-tool'), end('e1', 'ok')],
      [edge('x1', 's1', 't1')],
    );
    await expect(runGraph(graph, initOf('x'))).rejects.toThrow('结束节点');
  });
});
