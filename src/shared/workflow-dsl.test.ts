import { describe, expect, it } from 'vitest';
import {
  evaluateConditionExpression,
  extractTemplateNodeIds,
  renderTemplate,
  validateWorkflowGraph,
  workflowGraphSchema,
} from './workflow-dsl';
import type { ConditionExpression, WorkflowEdge, WorkflowGraph, WorkflowNode } from './workflow-dsl';

const pos = { x: 0, y: 0 };

function startNode(id: string): WorkflowNode {
  return { id, type: 'start', position: pos, data: {} };
}

function llmNode(id: string, prompt: string): WorkflowNode {
  return { id, type: 'llm', position: pos, data: { prompt } };
}

function toolNode(id: string, toolName: string, args: Record<string, unknown> = {}): WorkflowNode {
  return { id, type: 'tool', position: pos, data: { toolName, args } };
}

function conditionNode(id: string, branches: Array<{ id: string; expression?: ConditionExpression }>): WorkflowNode {
  return { id, type: 'condition', position: pos, data: { branches } };
}

function endNode(id: string, output: string): WorkflowNode {
  return { id, type: 'end', position: pos, data: { output } };
}

function edge(id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge {
  return sourceHandle === undefined
    ? { id, source, target }
    : { id, source, target, sourceHandle };
}

function graph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
  return { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges };
}

const TOOLS = ['weatherTool', 'webOpenUrl', 'webOpenUrlRendered'];

function codesOf(input: unknown) {
  const result = validateWorkflowGraph(input, { toolNames: TOOLS });
  return result.ok ? [] : result.errors.map((e) => e.code);
}

describe('workflowGraphSchema', () => {
  it('accepts a minimal valid graph', () => {
    const parsed = workflowGraphSchema.parse(graph([startNode('s1'), endNode('e1', '完成')], [edge('x1', 's1', 'e1')]));
    expect(parsed.nodes).toHaveLength(2);
  });

  it('strips runtime-only fields like measured/selected from nodes and edges', () => {
    const noisy = {
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{ ...startNode('s1'), measured: { width: 1, height: 1 }, selected: true, dragging: false }],
      edges: [{ ...edge('x1', 's1', 'e1'), selected: true }],
    };
    const parsed = workflowGraphSchema.parse(noisy);
    expect(parsed.nodes[0]).toEqual(startNode('s1'));
    expect(parsed.edges[0]).toEqual(edge('x1', 's1', 'e1'));
  });

  it.each([
    ['wrong version', { ...graph([], []), version: 2 }],
    ['unknown node type', graph([{ id: 'a', type: 'loop', position: pos, data: {} }] as never, [])],
    ['edge missing target', graph([startNode('s1'), endNode('e1', 'ok')], [{ id: 'x1', source: 's1' }] as never)],
    ['llm node missing prompt', graph([startNode('s1'), { id: 'n1', type: 'llm', position: pos, data: {} } as never], [])],
    ['condition operator outside the eight', graph([
      startNode('s1'),
      conditionNode('c1', [{ id: 'b1', expression: { left: 'a', op: 'regex' as never, right: 'b' } }]),
    ], [])],
  ])('rejects %s at the schema layer', (_label, input) => {
    expect(codesOf(input)).toContain('invalid_graph');
  });
});

describe('validateWorkflowGraph — start/end rules', () => {
  it('rejects a graph without a start node', () => {
    expect(codesOf(graph([endNode('e1', 'ok')], []))).toContain('missing_start');
  });

  it('rejects a graph with two start nodes', () => {
    expect(codesOf(graph([startNode('s1'), startNode('s2'), endNode('e1', 'ok')], [edge('x1', 's1', 'e1')]))).toContain(
      'multiple_start',
    );
  });

  it('rejects a graph without an end node', () => {
    expect(codesOf(graph([startNode('s1'), llmNode('n1', '你好')], [edge('x1', 's1', 'n1')]))).toContain('missing_end');
  });

  it('rejects an end node that is not reachable from start', () => {
    const input = graph(
      [startNode('s1'), llmNode('n1', '你好'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'n1')],
    );
    const result = validateWorkflowGraph(input, { toolNames: TOOLS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const unreachable = result.errors.find((e) => e.code === 'unreachable_end');
      expect(unreachable?.nodeId).toBe('e1');
    }
  });
});

describe('validateWorkflowGraph — connectivity rules', () => {
  it('rejects cycles', () => {
    const input = graph(
      [startNode('s1'), llmNode('a', '1'), llmNode('b', '2'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'a'), edge('x2', 'a', 'b'), edge('x3', 'b', 'a'), edge('x4', 'b', 'e1')],
    );
    expect(codesOf(input)).toContain('cycle_detected');
  });

  it('rejects a self-loop as a cycle', () => {
    const input = graph(
      [startNode('s1'), llmNode('a', '1'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'a'), edge('x2', 'a', 'a'), edge('x3', 'a', 'e1')],
    );
    expect(codesOf(input)).toContain('cycle_detected');
  });

  it('rejects orphan nodes unreachable from start', () => {
    const input = graph(
      [startNode('s1'), llmNode('a', '1'), llmNode('lonely', '2'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'a'), edge('x2', 'a', 'e1')],
    );
    const result = validateWorkflowGraph(input, { toolNames: TOOLS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const orphan = result.errors.find((e) => e.code === 'orphan_node');
      expect(orphan?.nodeId).toBe('lonely');
    }
  });

  it('collects multiple independent errors at once', () => {
    const input = graph(
      [startNode('s1'), llmNode('a', '1'), llmNode('b', '2'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'a'), edge('x2', 'a', 'b'), edge('x3', 'b', 'a')],
    );
    const codes = codesOf(input);
    expect(codes).toContain('cycle_detected');
    expect(codes).toContain('unreachable_end');
  });
});

describe('validateWorkflowGraph — interpolation references', () => {
  it('rejects a dangling node reference in llm prompt', () => {
    const input = graph(
      [startNode('s1'), llmNode('n1', '总结：{{ghost.output}}'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'n1'), edge('x2', 'n1', 'e1')],
    );
    const result = validateWorkflowGraph(input, { toolNames: TOOLS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const dangling = result.errors.find((e) => e.code === 'dangling_reference');
      expect(dangling?.nodeId).toBe('n1');
    }
  });

  it('rejects a reference to a field other than output', () => {
    const input = graph(
      [startNode('s1'), llmNode('n1', '{{s1.text}}'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'n1'), edge('x2', 'n1', 'e1')],
    );
    expect(codesOf(input)).toContain('invalid_reference');
  });

  it('checks string values inside tool args', () => {
    const input = graph(
      [startNode('s1'), toolNode('t1', 'weatherTool', { city: '{{ghost.output}}' }), endNode('e1', 'ok')],
      [edge('x1', 's1', 't1'), edge('x2', 't1', 'e1')],
    );
    expect(codesOf(input)).toContain('dangling_reference');
  });

  it('checks condition expressions and end output', () => {
    const input = graph(
      [
        startNode('s1'),
        conditionNode('c1', [
          { id: 'b1', expression: { left: '{{ghost.output}}', op: 'isEmpty', right: '' } },
          { id: 'b2' },
        ]),
        endNode('e1', '{{ghost.output}}'),
      ],
      [edge('x1', 's1', 'c1', 'b1'), edge('x2', 'c1', 'e1', 'b2')],
    );
    const result = validateWorkflowGraph(input, { toolNames: TOOLS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.filter((e) => e.code === 'dangling_reference')).toHaveLength(2);
    }
  });
});

describe('validateWorkflowGraph — tool and condition rules', () => {
  it('rejects a tool node whose toolName is not in the registry', () => {
    const input = graph(
      [startNode('s1'), toolNode('t1', 'notATool'), endNode('e1', 'ok')],
      [edge('x1', 's1', 't1'), edge('x2', 't1', 'e1')],
    );
    const result = validateWorkflowGraph(input, { toolNames: TOOLS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const unknown = result.errors.find((e) => e.code === 'unknown_tool');
      expect(unknown?.nodeId).toBe('t1');
    }
  });

  it('accepts every currently registered tool name', () => {
    const input = graph(
      [startNode('s1'), toolNode('t1', 'webOpenUrlRendered'), endNode('e1', 'ok')],
      [edge('x1', 's1', 't1'), edge('x2', 't1', 'e1')],
    );
    expect(codesOf(input)).not.toContain('unknown_tool');
  });

  it('rejects a condition node with fewer than two branches', () => {
    const input = graph(
      [startNode('s1'), conditionNode('c1', [{ id: 'b1', expression: { left: 'a', op: 'equals', right: 'b' } }]), endNode('e1', 'ok')],
      [edge('x1', 's1', 'c1', 'b1'), edge('x2', 'c1', 'e1')],
    );
    expect(codesOf(input)).toContain('too_few_branches');
  });

  it('rejects two fallback branches', () => {
    const input = graph(
      [startNode('s1'), conditionNode('c1', [{ id: 'b1' }, { id: 'b2' }]), endNode('e1', 'ok')],
      [edge('x1', 's1', 'c1', 'b1'), edge('x2', 'c1', 'e1', 'b2')],
    );
    expect(codesOf(input)).toContain('fallback_branch_position');
  });

  it('rejects a fallback branch that is not last', () => {
    const input = graph(
      [
        startNode('s1'),
        conditionNode('c1', [
          { id: 'b1' },
          { id: 'b2', expression: { left: 'a', op: 'equals', right: 'b' } },
        ]),
        endNode('e1', 'ok'),
      ],
      [edge('x1', 's1', 'c1', 'b1'), edge('x2', 'c1', 'e1', 'b2')],
    );
    expect(codesOf(input)).toContain('fallback_branch_position');
  });

  it('rejects a condition out-edge without a branch handle', () => {
    const input = graph(
      [startNode('s1'), conditionNode('c1', [{ id: 'b1', expression: { left: 'a', op: 'equals', right: 'b' } }, { id: 'b2' }]), endNode('e1', 'ok')],
      [edge('x1', 's1', 'c1', 'b1'), edge('x2', 'c1', 'e1')],
    );
    const result = validateWorkflowGraph(input, { toolNames: TOOLS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const badEdge = result.errors.find((e) => e.code === 'invalid_branch_edge');
      expect(badEdge?.nodeId).toBe('c1');
    }
  });

  it('rejects a condition out-edge whose handle matches no declared branch', () => {
    const input = graph(
      [startNode('s1'), conditionNode('c1', [{ id: 'b1', expression: { left: 'a', op: 'equals', right: 'b' } }, { id: 'b2' }]), endNode('e1', 'ok')],
      [edge('x1', 's1', 'c1', 'b1'), edge('x2', 'c1', 'e1', 'ghost-branch')],
    );
    expect(codesOf(input)).toContain('invalid_branch_edge');
  });

  it('rejects duplicate node ids', () => {
    const input = graph(
      [startNode('s1'), llmNode('n1', 'a'), llmNode('n1', 'b'), endNode('e1', 'ok')],
      [edge('x1', 's1', 'n1'), edge('x2', 'n1', 'e1')],
    );
    expect(codesOf(input)).toContain('duplicate_node_id');
  });

  it('accepts a well-formed if / else-if / else chain', () => {
    const input = graph(
      [
        startNode('s1'),
        llmNode('n1', '分析 {{s1.output}}'),
        conditionNode('c1', [
          { id: 'b1', expression: { left: '{{n1.output}}', op: 'contains', right: '晴' } },
          { id: 'b2', expression: { left: '{{n1.output}}', op: 'contains', right: '雨' } },
          { id: 'b3' },
        ]),
        endNode('e1', '结果：{{n1.output}}'),
        endNode('e2', '其他'),
      ],
      [
        edge('x1', 's1', 'n1'),
        edge('x2', 'n1', 'c1'),
        edge('x3', 'c1', 'e1', 'b1'),
        edge('x4', 'c1', 'e1', 'b2'),
        edge('x5', 'c1', 'e2', 'b3'),
      ],
    );
    const result = validateWorkflowGraph(input, { toolNames: TOOLS });
    expect(result.ok).toBe(true);
  });
});

describe('renderTemplate', () => {
  it('replaces references with upstream outputs', () => {
    const result = renderTemplate('结论：{{n1.output}}，基于 {{n2.output}}', { n1: '晴天', n2: '数据' });
    expect(result.text).toBe('结论：晴天，基于 数据');
    expect(result.missing).toEqual([]);
  });

  it('defensively replaces missing references with an empty string and records them', () => {
    const result = renderTemplate('a{{ghost.output}}b', {});
    expect(result.text).toBe('ab');
    expect(result.missing).toEqual(['ghost']);
  });

  it('leaves malformed templates untouched', () => {
    expect(renderTemplate('{{noField}} 和 {{also.bad}}', {}).text).toBe('{{noField}} 和 {{also.bad}}');
  });

  it('returns text without references unchanged', () => {
    expect(renderTemplate('纯文本', { n1: 'x' }).text).toBe('纯文本');
  });
});

describe('extractTemplateNodeIds', () => {
  it('collects node ids from well-formed output references only', () => {
    expect(extractTemplateNodeIds('a {{n1.output}} b {{n2.output}} c {{bad}} d {{n1.output}}')).toEqual(['n1', 'n2']);
    expect(extractTemplateNodeIds('无引用')).toEqual([]);
  });
});

describe('evaluateConditionExpression', () => {
  const outputs = { n1: '18', n2: '今天晴天', n3: '', n4: 'abc' };

  it.each<[string, ConditionExpression, boolean]>([
    ['equals', { left: '今天晴天', op: 'equals', right: '今天晴天' }, true],
    ['equals (mismatch)', { left: 'a', op: 'equals', right: 'b' }, false],
    ['notEquals', { left: 'a', op: 'notEquals', right: 'b' }, true],
    ['contains', { left: '{{n2.output}}', op: 'contains', right: '晴天' }, true],
    ['notContains', { left: '{{n2.output}}', op: 'notContains', right: '雨' }, true],
    ['gt with numeric strings', { left: '{{n1.output}}', op: 'gt', right: '10' }, true],
    ['lt with numeric strings', { left: '{{n1.output}}', op: 'lt', right: '10' }, false],
    ['gt with non-numeric side', { left: '{{n4.output}}', op: 'gt', right: '10' }, false],
    ['gt with non-numeric right', { left: '10', op: 'gt', right: '{{n4.output}}' }, false],
    ['isEmpty on empty', { left: '{{n3.output}}', op: 'isEmpty', right: 'ignored' }, true],
    ['notEmpty on empty', { left: '{{n3.output}}', op: 'notEmpty', right: 'ignored' }, false],
    ['empty string coerces to 0 per Number() semantics', { left: '{{n3.output}}', op: 'gt', right: '-1' }, true],
  ])('%s', (_label, expression, expected) => {
    expect(evaluateConditionExpression(expression, outputs)).toBe(expected);
  });
});
