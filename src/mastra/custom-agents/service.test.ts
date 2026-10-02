import { createClient, type Client } from '@libsql/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateWorkflowGraph } from '../../shared/workflow-dsl';
import { createCustomAgentsService, createDefaultTemplateGraph, type ApiResult } from './service';
import { ensureCustomAgentsTable } from './store';

const TOOLS = [
  { name: 'get-weather', description: '获取指定地点的当前天气' },
  { name: 'web-open-url', description: '抓取网页' },
  { name: 'web-open-url-rendered', description: '无头浏览器渲染抓取' },
];

let client: Client;
let service: ReturnType<typeof createCustomAgentsService>;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await ensureCustomAgentsTable(client);
  service = createCustomAgentsService({ client, tools: TOOLS });
});

const VALID_GRAPH = {
  version: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    { id: 's1', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'e1', type: 'end', position: { x: 0, y: 0 }, data: { output: '完成' } },
  ],
  edges: [{ id: 'x1', source: 's1', target: 'e1' }],
};

function errorsOf(result: ApiResult): Array<{ code: string; message: string; nodeId?: string }> {
  return (result.body as { errors: Array<{ code: string; message: string; nodeId?: string }> }).errors ?? [];
}

describe('createDefaultTemplateGraph', () => {
  it('produces a start → llm → end graph that passes validation and demos interpolation', () => {
    const graph = createDefaultTemplateGraph();
    const result = validateWorkflowGraph(graph, { toolNames: TOOLS.map((tool) => tool.name) });
    expect(result.ok).toBe(true);
    expect(graph.nodes.map((n) => n.type)).toEqual(['start', 'llm', 'end']);
    const llm = graph.nodes.find((n) => n.type === 'llm');
    const start = graph.nodes.find((n) => n.type === 'start');
    const end = graph.nodes.find((n) => n.type === 'end');
    expect(llm?.type === 'llm' && llm.data.prompt).toContain(`{{${start?.id}.output}}`);
    expect(end?.type === 'end' && end.data.output).toContain(`{{${llm?.id}.output}}`);
  });
});

describe('service.create', () => {
  it('creates with the default template graph when graph is omitted', async () => {
    const result = await service.create('r1', { name: '新助手' });
    expect(result.status).toBe(201);
    const body = result.body as { id: string; name: string; graph: { nodes: unknown[] } };
    expect(body.name).toBe('新助手');
    expect(body.graph.nodes).toHaveLength(3);
  });

  it('creates with an explicit valid graph', async () => {
    const result = await service.create('r1', { name: '显式', graph: VALID_GRAPH });
    expect(result.status).toBe(201);
  });

  it('rejects an invalid graph with 400 and the validation error list', async () => {
    const graph = {
      ...VALID_GRAPH,
      nodes: [
        VALID_GRAPH.nodes[0],
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { prompt: '{{ghost.output}}' } },
        VALID_GRAPH.nodes[1],
      ],
      edges: [
        { id: 'x1', source: 's1', target: 'n1' },
        { id: 'x2', source: 'n1', target: 'e1' },
      ],
    };
    const result = await service.create('r1', { name: '坏图', graph });
    expect(result.status).toBe(400);
    expect(errorsOf(result).some((e) => e.code === 'dangling_reference')).toBe(true);
  });

  it('rejects unknown tool names using the registry', async () => {
    const graph = {
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 's1', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 't1', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'not-a-tool', args: {} } },
        { id: 'e1', type: 'end', position: { x: 0, y: 0 }, data: { output: 'ok' } },
      ],
      edges: [
        { id: 'x1', source: 's1', target: 't1' },
        { id: 'x2', source: 't1', target: 'e1' },
      ],
    };
    const result = await service.create('r1', { name: '坏工具', graph });
    expect(result.status).toBe(400);
    expect(errorsOf(result).some((e) => e.code === 'unknown_tool')).toBe(true);
  });

  it.each([
    ['missing name', {}],
    ['empty name', { name: '   ' }],
    ['non-string name', { name: 42 }],
  ])('rejects %s with 400', async (_label, body) => {
    const result = await service.create('r1', body);
    expect(result.status).toBe(400);
    expect(errorsOf(result).some((e) => e.code === 'invalid_request')).toBe(true);
  });
});

describe('service.get / list / remove', () => {
  it('returns 404 for a missing or cross-resource id', async () => {
    const created = (await service.create('r1', { name: 'A' })).body as { id: string };
    expect((await service.get('r1', 'missing')).status).toBe(404);
    expect((await service.get('r2', created.id)).status).toBe(404);
  });

  it('returns the full definition with a parsed graph on get', async () => {
    const created = (await service.create('r1', { name: 'A' })).body as { id: string };
    const result = await service.get('r1', created.id);
    expect(result.status).toBe(200);
    const body = result.body as { id: string; name: string; graph: { version: number } };
    expect(body.graph.version).toBe(1);
  });

  it('lists summaries per resource without graph bodies', async () => {
    await service.create('r1', { name: 'A' });
    await service.create('r2', { name: 'B' });
    const list = await service.list('r1');
    expect(list.status).toBe(200);
    const body = list.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).not.toHaveProperty('graph');
  });

  it('returns 404 when deleting a missing or cross-resource id', async () => {
    expect((await service.remove('r1', 'missing')).status).toBe(404);
    const created = (await service.create('r1', { name: 'A' })).body as { id: string };
    expect((await service.remove('r2', created.id)).status).toBe(404);
    expect((await service.remove('r1', created.id)).status).toBe(200);
    expect((await service.get('r1', created.id)).status).toBe(404);
  });

  it('exposes the tool registry with names and descriptions', () => {
    const result = service.toolRegistry();
    expect(result.status).toBe(200);
    expect(result.body).toEqual(TOOLS);
  });
});

describe('service.update', () => {
  it('updates name and graph and returns the new definition', async () => {
    const created = (await service.create('r1', { name: '旧' })).body as { id: string; updatedAt: number };
    const result = await service.update('r1', created.id, { name: '新', graph: VALID_GRAPH });
    expect(result.status).toBe(200);
    const body = result.body as { name: string; graph: { nodes: unknown[] }; updatedAt: number };
    expect(body.name).toBe('新');
    expect(body.graph.nodes).toHaveLength(2);
    expect(body.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('rejects an invalid graph with 400 and keeps the old definition', async () => {
    const created = (await service.create('r1', { name: 'A' })).body as { id: string; name: string };
    const result = await service.update('r1', created.id, {
      name: '不应生效',
      graph: { ...VALID_GRAPH, nodes: [{ id: 'e1', type: 'end', position: { x: 0, y: 0 }, data: { output: '' } }] },
    });
    expect(result.status).toBe(400);
    const after = await service.get('r1', created.id);
    expect((after.body as { name: string }).name).toBe('A');
  });

  it('returns 404 for a missing id and 400 for a bad body', async () => {
    expect((await service.update('r1', 'missing', { graph: VALID_GRAPH })).status).toBe(404);
    const created = (await service.create('r1', { name: 'A' })).body as { id: string };
    expect((await service.update('r1', created.id, { name: 'x' })).status).toBe(400);
    expect((await service.update('r1', created.id, {})).status).toBe(400);
  });
});
