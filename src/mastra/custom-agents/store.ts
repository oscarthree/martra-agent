import { nanoid } from 'nanoid';
import type { Client } from '@libsql/client';

// 自定义 Agent 定义的应用层存储：与 Mastra 存储域分离，共用同一 LibSQL 库。
// 表结构变更无迁移框架，手动 ALTER。

export interface CustomAgentDefinition {
  id: string;
  name: string;
  resourceId: string;
  /** DSL JSON 字符串（workflow-dsl 的校验在 service 层做） */
  graph: string;
  createdAt: number;
  updatedAt: number;
}

export interface CustomAgentSummary {
  id: string;
  name: string;
  updatedAt: number;
}

interface DefinitionRow {
  id: string;
  name: string;
  resource_id: string;
  graph: string;
  created_at: number;
  updated_at: number;
}

export async function ensureCustomAgentsTable(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS custom_agent_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      graph TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_custom_agent_definitions_resource_updated
    ON custom_agent_definitions (resource_id, updated_at)
  `);
}

function rowToDefinition(row: DefinitionRow): CustomAgentDefinition {
  return {
    id: row.id,
    name: row.name,
    resourceId: row.resource_id,
    graph: row.graph,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomAgents(client: Client, resourceId: string): Promise<CustomAgentSummary[]> {
  const result = await client.execute({
    sql: 'SELECT id, name, updated_at FROM custom_agent_definitions WHERE resource_id = ? ORDER BY updated_at DESC, id ASC',
    args: [resourceId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    updatedAt: Number(row.updated_at),
  }));
}

export async function getCustomAgent(
  client: Client,
  id: string,
  resourceId: string,
): Promise<CustomAgentDefinition | null> {
  const result = await client.execute({
    sql: 'SELECT * FROM custom_agent_definitions WHERE id = ? AND resource_id = ?',
    args: [id, resourceId],
  });
  const row = result.rows[0] as unknown as DefinitionRow | undefined;
  return row === undefined ? null : rowToDefinition(row);
}

export async function createCustomAgent(
  client: Client,
  input: { resourceId: string; name: string; graph: string; id?: string },
): Promise<CustomAgentDefinition> {
  const id = input.id ?? nanoid();
  const now = Date.now();
  await client.execute({
    sql: 'INSERT INTO custom_agent_definitions (id, name, resource_id, graph, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, input.name, input.resourceId, input.graph, now, now],
  });
  return { id, name: input.name, resourceId: input.resourceId, graph: input.graph, createdAt: now, updatedAt: now };
}

export async function updateCustomAgent(
  client: Client,
  input: { id: string; resourceId: string; name?: string; graph?: string },
): Promise<CustomAgentDefinition | null> {
  const current = await getCustomAgent(client, input.id, input.resourceId);
  if (current === null) return null;
  const name = input.name ?? current.name;
  const graph = input.graph ?? current.graph;
  const updatedAt = Date.now();
  await client.execute({
    sql: 'UPDATE custom_agent_definitions SET name = ?, graph = ?, updated_at = ? WHERE id = ? AND resource_id = ?',
    args: [name, graph, updatedAt, input.id, input.resourceId],
  });
  return { ...current, name, graph, updatedAt };
}

export async function deleteCustomAgent(client: Client, id: string, resourceId: string): Promise<boolean> {
  const result = await client.execute({
    sql: 'DELETE FROM custom_agent_definitions WHERE id = ? AND resource_id = ?',
    args: [id, resourceId],
  });
  return result.rowsAffected > 0;
}
