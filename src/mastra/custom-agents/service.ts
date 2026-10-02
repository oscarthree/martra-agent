import { nanoid } from 'nanoid';
import type { Client } from '@libsql/client';
import { z } from 'zod';
import { validateWorkflowGraph, type WorkflowGraph } from '../../shared/workflow-dsl';
import {
  createCustomAgent,
  deleteCustomAgent,
  getCustomAgent,
  listCustomAgents,
  updateCustomAgent,
  type CustomAgentDefinition,
} from './store';

// /api/custom-agents 五个端点的服务层：endpoint 行为在此实现为纯函数（返回 status + body），
// Express 路由只做 resource-id 解析与透传，因此全部行为可无 HTTP 单测。

export interface ApiError {
  code: string;
  message: string;
  nodeId?: string;
}

export type ApiResult = { status: number; body: unknown };

export interface CustomAgentsService {
  list(resourceId: string): Promise<ApiResult>;
  get(resourceId: string, id: string): Promise<ApiResult>;
  create(resourceId: string, body: unknown): Promise<ApiResult>;
  update(resourceId: string, id: string, body: unknown): Promise<ApiResult>;
  remove(resourceId: string, id: string): Promise<ApiResult>;
  /** 后端工具注册表清单（编辑器工具节点选项用） */
  toolRegistry(): ApiResult;
}

const createBodySchema = z.object({
  name: z.string().trim().min(1, { message: '名称不能为空' }),
  graph: z.unknown().optional(),
});

const updateBodySchema = z.object({
  name: z.string().trim().min(1, { message: '名称不能为空' }).optional(),
  graph: z.unknown(),
});

export function createDefaultTemplateGraph(): WorkflowGraph {
  const startId = nanoid();
  const llmId = nanoid();
  const endId = nanoid();
  return {
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: startId, type: 'start', position: { x: 0, y: 0 }, data: {} },
      {
        id: llmId,
        type: 'llm',
        position: { x: 280, y: 0 },
        data: { prompt: `用户输入：{{${startId}.output}}\n\n请根据以上输入给出友好的中文回复。` },
      },
      { id: endId, type: 'end', position: { x: 560, y: 0 }, data: { output: `{{${llmId}.output}}` } },
    ],
    edges: [
      { id: nanoid(), source: startId, target: llmId },
      { id: nanoid(), source: llmId, target: endId },
    ],
  };
}

function serializeDefinition(definition: CustomAgentDefinition): ApiResult {
  return {
    status: 200,
    body: {
      id: definition.id,
      name: definition.name,
      resourceId: definition.resourceId,
      graph: JSON.parse(definition.graph) as unknown,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
    },
  };
}

function errorResult(status: number, errors: ApiError[]): ApiResult {
  return { status, body: { errors } };
}

function notFound(): ApiResult {
  return { status: 404, body: { errors: [{ code: 'not_found', message: '自定义 Agent 定义不存在' }] } };
}

export function createCustomAgentsService(deps: {
  client: Client;
  tools: ReadonlyArray<{ name: string; description: string }>;
}): CustomAgentsService {
  const toolNames = deps.tools.map((tool) => tool.name);
  const validateGraph = (graph: unknown): { ok: true; graph: WorkflowGraph } | { ok: false; result: ApiResult } => {
    const result = validateWorkflowGraph(graph, { toolNames });
    return result.ok ? { ok: true, graph: result.graph } : { ok: false, result: errorResult(400, result.errors) };
  };

  return {
    async list(resourceId) {
      return { status: 200, body: await listCustomAgents(deps.client, resourceId) };
    },

    async get(resourceId, id) {
      const definition = await getCustomAgent(deps.client, id, resourceId);
      return definition === null ? notFound() : serializeDefinition(definition);
    },

    async create(resourceId, body) {
      const parsed = createBodySchema.safeParse(body);
      if (!parsed.success) {
        return errorResult(400,
          parsed.error.issues.map((issue) => ({ code: 'invalid_request', message: issue.message })),
      );
      }
      let graph: WorkflowGraph;
      if (parsed.data.graph === undefined) {
        graph = createDefaultTemplateGraph();
      } else {
        const validated = validateGraph(parsed.data.graph);
        if (!validated.ok) return validated.result;
        graph = validated.graph;
      }
      const definition = await createCustomAgent(deps.client, {
        resourceId,
        name: parsed.data.name,
        graph: JSON.stringify(graph),
      });
      const result = serializeDefinition(definition);
      return { status: 201, body: result.body };
    },

    async update(resourceId, id, body) {
      const parsed = updateBodySchema.safeParse(body);
      if (!parsed.success) {
        return errorResult(400,
          parsed.error.issues.map((issue) => ({ code: 'invalid_request', message: issue.message })),
      );
      }
      const validated = validateGraph(parsed.data.graph);
      if (!validated.ok) return validated.result;
      const definition = await updateCustomAgent(deps.client, {
        id,
        resourceId,
        name: parsed.data.name,
        graph: JSON.stringify(validated.graph),
      });
      return definition === null ? notFound() : serializeDefinition(definition);
    },

    async remove(resourceId, id) {
      const deleted = await deleteCustomAgent(deps.client, id, resourceId);
      return deleted ? { status: 200, body: { deleted: true } } : notFound();
    },

    toolRegistry() {
      return { status: 200, body: [...deps.tools] };
    },
  };
}
