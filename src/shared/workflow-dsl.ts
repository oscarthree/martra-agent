import { z } from 'zod';

// 自定义 Agent 图 DSL 的事实标准：前后端双端复用的 zod schema、
// 保存时语义校验、运行期插值渲染与条件求值。模块不得依赖任何端特有 API。

// ---------- zod schema（存储格式 = xyflow toObject() 形状，version 1） ----------

const positionSchema = z.object({ x: z.number(), y: z.number() });

export const conditionOperatorSchema = z.enum([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'gt',
  'lt',
  'isEmpty',
  'notEmpty',
]);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

export const conditionExpressionSchema = z.object({
  left: z.string(),
  op: conditionOperatorSchema,
  right: z.string(),
});
export type ConditionExpression = z.infer<typeof conditionExpressionSchema>;

export const conditionBranchSchema = z.object({
  id: z.string().min(1),
  expression: conditionExpressionSchema.optional(),
});
export type ConditionBranch = z.infer<typeof conditionBranchSchema>;

const baseNodeFields = {
  id: z.string().min(1),
  position: positionSchema,
};

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...baseNodeFields, type: z.literal('start'), data: z.object({}) }),
  z.object({ ...baseNodeFields, type: z.literal('llm'), data: z.object({ prompt: z.string() }) }),
  z.object({
    ...baseNodeFields,
    type: z.literal('tool'),
    data: z.object({
      toolName: z.string().min(1),
      args: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    ...baseNodeFields,
    type: z.literal('condition'),
    data: z.object({ branches: z.array(conditionBranchSchema) }),
  }),
  z.object({ ...baseNodeFields, type: z.literal('end'), data: z.object({ output: z.string() }) }),
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowGraphSchema = z.object({
  version: z.literal(1),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

// ---------- 保存时语义校验 ----------

export type GraphValidationErrorCode =
  | 'invalid_graph'
  | 'missing_start'
  | 'multiple_start'
  | 'missing_end'
  | 'unreachable_end'
  | 'orphan_node'
  | 'cycle_detected'
  | 'dangling_reference'
  | 'invalid_reference'
  | 'unknown_tool'
  | 'too_few_branches'
  | 'fallback_branch_position'
  | 'invalid_branch_edge'
  | 'duplicate_node_id';

export interface GraphValidationError {
  code: GraphValidationErrorCode;
  message: string;
  nodeId?: string;
}

export type WorkflowGraphValidationResult =
  | { ok: true; graph: WorkflowGraph }
  | { ok: false; errors: GraphValidationError[] };

export interface ValidateWorkflowGraphOptions {
  /** 后端工具注册表名单，用于校验 tool 节点的 toolName */
  toolNames: readonly string[];
}

export function validateWorkflowGraph(
  input: unknown,
  options: ValidateWorkflowGraphOptions,
): WorkflowGraphValidationResult {
  const parsed = workflowGraphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        code: 'invalid_graph',
        message: `图结构不合法：${issue.path.join('.')} ${issue.message}`,
      })),
    };
  }
  const errors = collectSemanticErrors(parsed.data, options);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, graph: parsed.data };
}

function collectSemanticErrors(graph: WorkflowGraph, options: ValidateWorkflowGraphOptions): GraphValidationError[] {
  const errors: GraphValidationError[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  // §2.1：节点 id 唯一
  const seenNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (seenNodeIds.has(node.id)) {
      errors.push({ code: 'duplicate_node_id', message: `节点 id ${node.id} 重复`, nodeId: node.id });
    } else {
      seenNodeIds.add(node.id);
    }
  }

  // §2.1/§2.2：condition 出边必须带 sourceHandle 且匹配已声明的分支 id
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    if (source?.type !== 'condition') continue;
    const branchIds = new Set(source.data.branches.map((branch) => branch.id));
    if (edge.sourceHandle === undefined || !branchIds.has(edge.sourceHandle)) {
      errors.push({
        code: 'invalid_branch_edge',
        message: `条件节点 ${edge.source} 的出边必须经分支 handle 连出（${edge.sourceHandle ?? '缺失'} 不是已声明的分支）`,
        nodeId: edge.source,
      });
    }
  }

  // 规则 1：恰好一个 start
  const startNodes = graph.nodes.filter((node) => node.type === 'start');
  if (startNodes.length === 0) {
    errors.push({ code: 'missing_start', message: '图中必须有一个开始节点' });
  }
  for (const extra of startNodes.slice(1)) {
    errors.push({ code: 'multiple_start', message: `开始节点只能有一个（${extra.id} 多余）`, nodeId: extra.id });
  }

  // 规则 2 前半：至少一个 end
  if (!graph.nodes.some((node) => node.type === 'end')) {
    errors.push({ code: 'missing_end', message: '图中必须有一个结束节点' });
  }

  // 规则 7：condition 分支规则（结构合法后逐节点检查）
  for (const node of graph.nodes) {
    if (node.type !== 'condition') continue;
    const branches = node.data.branches;
    if (branches.length < 2) {
      errors.push({ code: 'too_few_branches', message: '条件节点至少要有两个分支', nodeId: node.id });
      continue;
    }
    const fallbackIndexes = branches.flatMap((branch, index) => (branch.expression === undefined ? [index] : []));
    const fallbackNotLast = fallbackIndexes.filter((index) => index !== branches.length - 1);
    if (fallbackIndexes.length > 1 || fallbackNotLast.length > 0) {
      errors.push({
        code: 'fallback_branch_position',
        message: '兜底分支最多一个，且只能在末位',
        nodeId: node.id,
      });
    }
  }

  // 规则 6：toolName 必须在注册表内
  for (const node of graph.nodes) {
    if (node.type !== 'tool') continue;
    if (!options.toolNames.includes(node.data.toolName)) {
      errors.push({
        code: 'unknown_tool',
        message: `工具 ${node.data.toolName} 不在后端工具注册表内`,
        nodeId: node.id,
      });
    }
  }

  // 规则 5：插值引用必须存在
  for (const node of graph.nodes) {
    const templates = templatesOfNode(node);
    for (const { text, field } of templates) {
      for (const rawRef of extractRawRefs(text)) {
        const ref = parseRef(rawRef);
        if (ref === null) {
          errors.push({
            code: 'invalid_reference',
            message: `插值 {{${rawRef}}} 格式不正确，应为 {{节点id.output}}（${field}）`,
            nodeId: node.id,
          });
          continue;
        }
        if (ref.field !== 'output') {
          errors.push({
            code: 'invalid_reference',
            message: `插值 {{${rawRef}}} 引用了不支持的字段 ${ref.field}，只支持 .output（${field}）`,
            nodeId: node.id,
          });
          continue;
        }
        if (!nodeIds.has(ref.nodeId)) {
          errors.push({
            code: 'dangling_reference',
            message: `插值 {{${rawRef}}} 引用了不存在的节点（${field}）`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  // 规则 2/3/4：可达性、环、孤儿（start 缺失时跳过这部分，避免噪音错误）
  const start = startNodes[0];
  if (start !== undefined) {
    const adjacency = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const next = adjacency.get(edge.source);
      if (next === undefined) {
        adjacency.set(edge.source, [edge.target]);
      } else {
        next.push(edge.target);
      }
    }

    const cyclicNodeIds = findCycleNodes(start.id, adjacency);
    for (const nodeId of cyclicNodeIds) {
      errors.push({ code: 'cycle_detected', message: `图中存在环，涉及节点 ${nodeId}`, nodeId });
    }

    const reachable = reachableFrom(start.id, adjacency);
    for (const node of graph.nodes) {
      if (reachable.has(node.id)) continue;
      if (node.type === 'end') {
        errors.push({ code: 'unreachable_end', message: `结束节点 ${node.id} 从开始节点不可达`, nodeId: node.id });
      } else {
        errors.push({ code: 'orphan_node', message: `节点 ${node.id} 从开始节点不可达`, nodeId: node.id });
      }
    }
  }

  return errors;
}

function templatesOfNode(node: WorkflowNode): Array<{ text: string; field: string }> {
  switch (node.type) {
    case 'llm':
      return [{ text: node.data.prompt, field: 'prompt' }];
    case 'tool':
      return Object.entries(node.data.args)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, value]) => ({ text: value, field: `args.${key}` }));
    case 'condition':
      return node.data.branches.flatMap((branch) =>
        branch.expression === undefined
          ? []
          : [
              { text: branch.expression.left, field: `分支 ${branch.id} 的 left` },
              { text: branch.expression.right, field: `分支 ${branch.id} 的 right` },
            ],
      );
    case 'end':
      return [{ text: node.data.output, field: 'output' }];
    default:
      return [];
  }
}

function reachableFrom(startId: string, adjacency: ReadonlyMap<string, string[]>): Set<string> {
  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

/** DFS 三色标记，返回所有在环上（或能回到已访问栈中节点）的目标节点 id */
function findCycleNodes(startId: string, adjacency: ReadonlyMap<string, string[]>): Set<string> {
  const cyclic = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    inStack.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (inStack.has(next)) {
        cyclic.add(next);
      } else {
        visit(next);
      }
    }
    inStack.delete(nodeId);
    visited.add(nodeId);
  };
  visit(startId);
  return cyclic;
}

// ---------- 运行期插值渲染 ----------

const TEMPLATE_RE = /\{\{([^{}]+)\}\}/g;

interface TemplateRef {
  nodeId: string;
  field: string;
}

function parseRef(inner: string): TemplateRef | null {
  const trimmed = inner.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) return null;
  return { nodeId: trimmed.slice(0, dot), field: trimmed.slice(dot + 1) };
}

function extractRawRefs(template: string): string[] {
  return [...template.matchAll(TEMPLATE_RE)].map((match) => match[1] ?? '');
}

export interface RenderedTemplate {
  text: string;
  /** 引用了但 outputs 中不存在的节点 id（防御性替换为空串） */
  missing: string[];
}

export function renderTemplate(
  template: string,
  outputs: Readonly<Record<string, string>>,
): RenderedTemplate {
  const missing: string[] = [];
  const text = template.replace(TEMPLATE_RE, (raw, inner: string) => {
    const ref = parseRef(inner);
    if (ref === null || ref.field !== 'output') return raw;
    const value = outputs[ref.nodeId];
    if (value === undefined) {
      missing.push(ref.nodeId);
      return '';
    }
    return value;
  });
  return { text, missing };
}

// ---------- 运行期条件求值 ----------

export function evaluateConditionExpression(
  expression: ConditionExpression,
  outputs: Readonly<Record<string, string>>,
): boolean {
  const left = renderTemplate(expression.left, outputs).text;
  if (expression.op === 'isEmpty') return left === '';
  if (expression.op === 'notEmpty') return left !== '';
  const right = renderTemplate(expression.right, outputs).text;
  switch (expression.op) {
    case 'equals':
      return left === right;
    case 'notEquals':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case 'notContains':
      return !left.includes(right);
    case 'gt':
    case 'lt': {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) return false;
      return expression.op === 'gt' ? leftNumber > rightNumber : leftNumber < rightNumber;
    }
  }
}
