import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCustomAgent,
  deleteCustomAgent,
  ensureCustomAgentsTable,
  getCustomAgent,
  listCustomAgents,
  updateCustomAgent,
} from './store';

const GRAPH = JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] });

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await ensureCustomAgentsTable(client);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureCustomAgentsTable', () => {
  it('is idempotent', async () => {
    await expect(ensureCustomAgentsTable(client)).resolves.toBeUndefined();
  });
});

describe('createCustomAgent / getCustomAgent', () => {
  it('creates a definition and reads it back', async () => {
    const created = await createCustomAgent(client, { resourceId: 'r1', name: '助手A', graph: GRAPH });
    expect(created.id).not.toBe('');
    expect(created.name).toBe('助手A');
    expect(created.resourceId).toBe('r1');
    expect(created.graph).toBe(GRAPH);
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.updatedAt).toBe(created.createdAt);

    const fetched = await getCustomAgent(client, created.id, 'r1');
    expect(fetched).toEqual(created);
  });

  it('returns null when the id exists under another resource', async () => {
    const created = await createCustomAgent(client, { resourceId: 'r1', name: '助手A', graph: GRAPH });
    expect(await getCustomAgent(client, created.id, 'r2')).toBeNull();
    expect(await getCustomAgent(client, 'missing', 'r1')).toBeNull();
  });
});

describe('listCustomAgents', () => {
  it('lists summaries without the graph body', async () => {
    await createCustomAgent(client, { resourceId: 'r1', name: '助手A', graph: GRAPH });
    const list = await listCustomAgents(client, 'r1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: '助手A' });
    expect(list[0]).not.toHaveProperty('graph');
    expect(list[0]).not.toHaveProperty('resourceId');
  });

  it('is isolated per resource and sorted by updatedAt desc', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const a = await createCustomAgent(client, { resourceId: 'r1', name: 'A', graph: GRAPH });
    now = 2_000;
    await updateCustomAgent(client, { id: a.id, resourceId: 'r1', name: 'A2' });
    now = 3_000;
    await createCustomAgent(client, { resourceId: 'r1', name: 'B', graph: GRAPH });
    now = 4_000;
    await createCustomAgent(client, { resourceId: 'r2', name: 'C', graph: GRAPH });

    const list = await listCustomAgents(client, 'r1');
    expect(list.map((s) => s.name)).toEqual(['B', 'A2']);
    expect(await listCustomAgents(client, 'r2').then((l) => l.map((s) => s.name))).toEqual(['C']);
    expect(await listCustomAgents(client, 'nowhere')).toEqual([]);
  });
});

describe('updateCustomAgent', () => {
  it('updates name and graph independently and bumps updatedAt', async () => {
    const created = await createCustomAgent(client, { resourceId: 'r1', name: '旧名', graph: GRAPH });
    const newGraph = JSON.stringify({ version: 1, viewport: { x: 1, y: 2, zoom: 3 }, nodes: [], edges: [] });
    const renamed = await updateCustomAgent(client, { id: created.id, resourceId: 'r1', name: '新名' });
    expect(renamed?.name).toBe('新名');
    expect(renamed?.graph).toBe(GRAPH);
    const regraphed = await updateCustomAgent(client, { id: created.id, resourceId: 'r1', graph: newGraph });
    expect(regraphed?.graph).toBe(newGraph);
    expect(regraphed?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('returns null for a missing id or another resource', async () => {
    const created = await createCustomAgent(client, { resourceId: 'r1', name: 'A', graph: GRAPH });
    expect(await updateCustomAgent(client, { id: created.id, resourceId: 'r2', name: 'x' })).toBeNull();
    expect(await updateCustomAgent(client, { id: 'missing', resourceId: 'r1', name: 'x' })).toBeNull();
  });
});

describe('deleteCustomAgent', () => {
  it('deletes and reports whether a row was removed', async () => {
    const created = await createCustomAgent(client, { resourceId: 'r1', name: 'A', graph: GRAPH });
    expect(await deleteCustomAgent(client, created.id, 'r1')).toBe(true);
    expect(await getCustomAgent(client, created.id, 'r1')).toBeNull();
    expect(await deleteCustomAgent(client, created.id, 'r1')).toBe(false);
    expect(await deleteCustomAgent(client, created.id, 'r2')).toBe(false);
  });
});
