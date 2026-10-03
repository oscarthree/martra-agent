import { Agent } from '@mastra/core/agent';
import type { Mastra } from '@mastra/core/mastra';
import type { Tool } from '@mastra/core/tools';
import { createStep, createWorkflow, type Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  evaluateConditionExpression,
  extractTemplateNodeIds,
  renderTemplate,
  type ConditionBranch,
  type ConditionExpression,
  type WorkflowGraph,
  type WorkflowNode,
} from '../../shared/workflow-dsl';
import { kimi, SessionMemory } from '../agents/shared';
import { withRetry } from '../utils/retry';
import { getToolByName } from './tool-registry';

// 图 JSON → Mastra workflow 编译器。
// 运行时上下文（当前消息 / 线程 / resource）作为 workflow 输入随请求流入，
// 节点 step 通过 getInitData() 读取；节点间数据经 getStepResult(nodeId) 按 id 取值插值。

export interface WorkflowInit {
  userMessage: string;
  threadId: string;
  resourceId: string;
}

const workflowInitSchema = z.object({
  userMessage: z.string(),
  threadId: z.string(),
  resourceId: z.string(),
});

type OutputResolver = (nodeId: string) => unknown;

// 运行期节点输出表：真实 step 与分支复合 step（内部节点对 getStepResult 不可见）
// 都把输出记到 runId 下，插值解析优先读这里。WorkflowAgent 在 run 结束后 dispose。
const runOutputs = new Map<string, Map<string, string>>();

function recordOutput(runId: string, nodeId: string, text: string): void {
  let outputs = runOutputs.get(runId);
  if (!outputs) {
    outputs = new Map();
    runOutputs.set(runId, outputs);
  }
  outputs.set(nodeId, text);
}

function readOutput(runId: string, nodeId: string): string | undefined {
  return runOutputs.get(runId)?.get(nodeId);
}

export function disposeRunOutputs(runId: string): void {
  runOutputs.delete(runId);
}

interface NodeContext {
  init: () => WorkflowInit;
  resolve: OutputResolver;
}

export interface CompileDeps {
  mastra: Mastra;
  /** 测试可注入假工具；缺省用真实注册表 */
  tools?: ReadonlyMap<string, Tool>;
}

// ---------- 插值与条件求值的运行时封装 ----------

function stringifyOutput(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
}

function resolveSafely(resolve: OutputResolver, nodeId: string): string {
  try {
    return stringifyOutput(resolve(nodeId));
  } catch {
    return '';
  }
}

function buildOutputs(templates: string[], resolve: OutputResolver): Record<string, string> {
  const ids = new Set(templates.flatMap((template) => extractTemplateNodeIds(template)));
  const outputs: Record<string, string> = {};
  for (const id of ids) {
    outputs[id] = resolveSafely(resolve, id);
  }
  return outputs;
}

function renderForNode(template: string, resolve: OutputResolver): string {
  return renderTemplate(template, buildOutputs([template], resolve)).text;
}

function safeEvaluate(expression: ConditionExpression, resolve: OutputResolver): boolean {
  try {
    const outputs = buildOutputs([expression.left, expression.right], resolve);
    return evaluateConditionExpression(expression, outputs);
  } catch {
    return false;
  }
}

// ---------- 条件分支取反链 ----------
// Mastra .branch() 对多个为真的条件并行执行，这里给第 N 个分支附加
// "前 N-1 个均不成立"的取反链实现 if / else-if / else 短路；条件抛错按 false 处理。

export function branchConditionFor(
  branches: ConditionBranch[],
  index: number,
): (params: { getStepResult: (step: string) => unknown }) => Promise<boolean> {
  return async ({ getStepResult }) => {
    const resolve: OutputResolver = (nodeId) => getStepResult(nodeId);
    for (let before = 0; before < index; before += 1) {
      const previous = branches[before]?.expression;
      if (previous !== undefined && safeEvaluate(previous, resolve)) {
        return false;
      }
    }
    const own = branches[index]?.expression;
    if (own === undefined) return true; // 兜底分支
    return safeEvaluate(own, resolve);
  };
}

// ---------- 节点执行器（真实 step 与分支复合 step 共用） ----------

type NodeExecutor = (node: WorkflowNode, ctx: NodeContext) => Promise<string>;

function createNodeExecutors(
  deps: CompileDeps,
  nodeAgents: Map<string, Agent>,
  nodeMemory: SessionMemory,
): Record<WorkflowNode['type'], NodeExecutor> {
  return {
    start: async (_node, ctx) => ctx.init().userMessage,

    end: async (node, ctx) => {
      if (node.type !== 'end') throw new Error('unreachable');
      return renderForNode(node.data.output, ctx.resolve);
    },

    tool: async (node, ctx) => {
      if (node.type !== 'tool') throw new Error('unreachable');
      const tool = deps.tools?.get(node.data.toolName) ?? getToolByName(node.data.toolName);
      if (!tool) {
        throw new Error(`工具 ${node.data.toolName} 不在后端工具注册表内`);
      }
      const outputs = buildOutputs(
        Object.values(node.data.args).filter((value): value is string => typeof value === 'string'),
        ctx.resolve,
      );
      const args = Object.fromEntries(
        Object.entries(node.data.args).map(([key, value]) => [
          key,
          typeof value === 'string' ? renderTemplate(value, outputs).text : value,
        ]),
      );
      const result = await tool.execute!(args as never, {} as never);
      return JSON.stringify(result);
    },

    llm: createLlmExecutor(deps, nodeAgents, nodeMemory),

    condition: async () => {
      throw new Error('condition 节点是路由点，没有执行体');
    },
  };
}

// 编译期为每个 LLM 节点创建闭包持有的节点 agent（不挂 memory，防写回污染），
// 以及一份共享的只读 SessionMemory（thread 历史经它 recall）。
function createCompileTimeArtifacts(graph: WorkflowGraph, deps: CompileDeps) {
  const nodeAgents = new Map<string, Agent>();
  for (const node of graph.nodes) {
    if (node.type !== 'llm') continue;
    const agent = new Agent({
      id: `custom-llm-${node.id}`,
      name: `LLM node ${node.id}`,
      instructions:
        '你是工作流节点执行器。用户消息是上游节点拼好的完整任务提示，直接执行任务并只输出结果文本，不要寒暄、不要复述任务。',
      model: kimi.chatModel('kimi-k2.7-code'),
    });
    // 与 workflow 一样只挂存储/追踪，不进注册表
    agent.__registerMastra(deps.mastra);
    nodeAgents.set(node.id, agent);
  }
  const nodeMemory = new SessionMemory();
  (nodeMemory as unknown as { __registerMastra(m: Mastra): void }).__registerMastra(deps.mastra);
  // 与 Agent.getMemory() 的接线一致：除注册 mastra 外还要显式给 storage，
  // 否则 recall() 落到 storage getter 直接抛 "Memory requires a storage provider"
  const storage = deps.mastra.getStorage();
  if (storage) {
    nodeMemory.setStorage(storage);
  }
  return { nodeAgents, nodeMemory };
}

function createLlmExecutor(deps: CompileDeps, nodeAgents: Map<string, Agent>, nodeMemory: SessionMemory): NodeExecutor {
  return async (node, ctx) => {
    if (node.type !== 'llm') throw new Error('unreachable');
    const agent = nodeAgents.get(node.id);
    if (!agent) throw new Error(`LLM 节点 ${node.id} 缺少编译期 agent`);

    const init = ctx.init();
    // 只读历史手动拼 prompt，不写回：节点 agent 不挂 memory（stream 就不会自动持久化），
    // recall 走编译期共享的 SessionMemory（保留 No thread found 软化）。
    const { messages: history } = await nodeMemory.recall({
      threadId: init.threadId,
      resourceId: init.resourceId,
      perPage: false,
    });
    const prompt = renderForNode(node.data.prompt, ctx.resolve);
    const historyMessages = history.map((message) => ({
      role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: mastraMessageText(message),
    }));

    return withRetry(async () => {
      const response = await agent.stream([
        ...historyMessages,
        { role: 'user' as const, content: prompt },
      ] as never);
      let text = '';
      for await (const chunk of response.textStream) {
        text += chunk;
      }
      return text;
    }, `LLM node ${node.id}`);
  };
}

function mastraMessageText(message: { content: unknown }): string {
  const content = message.content as { parts?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(content?.parts)) return '';
  return content.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}

// ---------- 图结构分析 ----------

interface ChainOutcome {
  /** 分支链上的节点（不含末尾 end / 汇聚点） */
  ids: string[];
  terminal: { kind: 'end' } | { kind: 'convergence'; id: string } | { kind: 'nested-condition' };
}

class GraphShape {
  private byId: Map<string, WorkflowNode>;
  private outgoing: Map<string, string[]>;
  private incomingCount: Map<string, number>;

  constructor(private graph: WorkflowGraph) {
    this.byId = new Map(graph.nodes.map((node) => [node.id, node]));
    this.outgoing = new Map();
    this.incomingCount = new Map();
    for (const edge of graph.edges) {
      const list = this.outgoing.get(edge.source);
      if (list) list.push(edge.target);
      else this.outgoing.set(edge.source, [edge.target]);
      this.incomingCount.set(edge.target, (this.incomingCount.get(edge.target) ?? 0) + 1);
    }
  }

  node(id: string): WorkflowNode {
    const node = this.byId.get(id);
    if (!node) throw new Error(`节点 ${id} 不在图中`);
    return node;
  }

  successors(id: string): string[] {
    return this.outgoing.get(id) ?? [];
  }

  indegree(id: string): number {
    return this.incomingCount.get(id) ?? 0;
  }

  branchTarget(conditionId: string, branchId: string): string {
    const edge = this.graph.edges.find(
      (e) => e.source === conditionId && e.sourceHandle === branchId,
    );
    if (!edge) throw new Error(`条件节点 ${conditionId} 的分支 ${branchId} 没有连线目标`);
    return edge.target;
  }

  /** 沿单后继链走到 end / 汇聚点 / 内嵌条件；用于分支链编译 */
  chainFrom(startId: string): ChainOutcome {
    const ids: string[] = [];
    let current = startId;
    for (let guard = 0; guard < 1000; guard += 1) {
      const node = this.node(current);
      if (node.type === 'end') {
        return { ids, terminal: { kind: 'end' } };
      }
      if (node.type === 'condition') {
        // v1：条件内嵌分支必须各自走到 end，不支持在内嵌条件之后再汇聚
        for (const branch of node.data.branches) {
          const sub = this.chainFrom(this.branchTarget(node.id, branch.id));
          if (sub.terminal.kind !== 'end') {
            throw new Error(`条件节点 ${node.id} 的内嵌分支暂不支持汇聚，请让每条分支直达结束节点`);
          }
        }
        return { ids: [...ids, current], terminal: { kind: 'nested-condition' } };
      }
      const successors = this.successors(current);
      if (successors.length === 0) {
        throw new Error(`节点 ${current} 的执行链到不了任何结束节点`);
      }
      if (successors.length > 1) {
        throw new Error(`节点 ${current} 存在多条出边：只有条件节点能分出分支`);
      }
      const next = successors[0]!;
      ids.push(current);
      if (this.indegree(next) > 1) {
        return { ids, terminal: { kind: 'convergence', id: next } };
      }
      current = next;
    }
    throw new Error('图过大，编译终止');
  }
}

// ---------- 编译 ----------

export function compileWorkflow(graph: WorkflowGraph, deps: CompileDeps): Workflow {
  const shape = new GraphShape(graph);
  const { nodeAgents, nodeMemory } = createCompileTimeArtifacts(graph, deps);
  const executors = createNodeExecutors(deps, nodeAgents, nodeMemory);

  const makeStep = (node: WorkflowNode) =>
    createStep({
      id: node.id,
      description: `${node.type} node`,
      inputSchema: z.unknown(),
      outputSchema: z.string(),
      execute: async ({ inputData, getInitData, getStepResult, runId }) => {
        const ctx: NodeContext = {
          init: () => getInitData<WorkflowInit>(),
          resolve: (nodeId) => readOutput(runId, nodeId) ?? getStepResult(nodeId),
        };
        let text: string;
        if (node.type === 'start') {
          // 起始节点的 inputData 就是 workflow 输入；容错取 init
          const fromInput = inputData as WorkflowInit | undefined;
          text =
            typeof fromInput?.userMessage === 'string' ? fromInput.userMessage : ctx.init().userMessage;
        } else {
          text = await executors[node.type](node, ctx);
        }
        recordOutput(runId, node.id, text);
        return text;
      },
    });

  // 复合 step：分支内多节点链 / 内嵌条件走手工顺序解释（语义与顶层取反链一致）
  const makeCompositeStep = (id: string, startId: string, convergenceId?: string) =>
    createStep({
      id,
      description: 'branch chain',
      inputSchema: z.unknown(),
      outputSchema: z.string(),
      execute: async ({ getInitData, getStepResult, runId }) => {
        const local = new Map<string, string>();
        const resolve: OutputResolver = (nodeId) =>
          readOutput(runId, nodeId) ??
          (local.has(nodeId) ? local.get(nodeId) : getStepResult(nodeId));
        const ctx: NodeContext = { init: () => getInitData<WorkflowInit>(), resolve };

        let current = startId;
        let lastText = '';
        for (let guard = 0; guard < 1000; guard += 1) {
          if (current === convergenceId) return lastText;
          const node = shape.node(current);
          if (node.type === 'end') {
            const text = await executors.end(node, ctx);
            recordOutput(runId, node.id, text);
            return text;
          }
          if (node.type === 'condition') {
            const picked = await pickBranch(node, resolve);
            current = shape.branchTarget(node.id, picked);
            continue;
          }
          lastText = await executors[node.type](node, ctx);
          local.set(node.id, lastText);
          recordOutput(runId, node.id, lastText);
          const successors = shape.successors(current);
          if (successors.length === 0) {
            throw new Error(`节点 ${current} 的执行未能到达结束节点`);
          }
          current = successors[0]!;
        }
        throw new Error('分支链执行超出上限');
      },
    });

  let workflow = createWorkflow({
    id: `custom-workflow-${graph.nodes.map((n) => n.id).join('-')}`.slice(0, 64),
    inputSchema: workflowInitSchema,
    outputSchema: z.string(),
  }) as Workflow;

  const startNode = graph.nodes.find((node) => node.type === 'start');
  if (!startNode) throw new Error('图中没有开始节点');

  let current: string | null = startNode.id;
  for (let guard = 0; guard < 1000 && current !== null; guard += 1) {
    const node = shape.node(current);

    if (node.type === 'end') {
      workflow = workflow.then(makeStep(node)) as Workflow;
      current = null;
      continue;
    }

    if (node.type === 'condition') {
      const targets = node.data.branches.map((branch) => shape.branchTarget(node.id, branch.id));
      if (new Set(targets).size !== targets.length) {
        throw new Error(`条件节点 ${node.id} 有多个分支指向同一节点：请改为连线汇聚`);
      }
      const outcomes = targets.map((target) => shape.chainFrom(target));
      const allEnd = outcomes.every((outcome) => outcome.terminal.kind === 'end');
      const convergenceIds = outcomes.map((outcome) =>
        outcome.terminal.kind === 'convergence' ? outcome.terminal.id : null,
      );
      const shared =
        !allEnd && convergenceIds.every((id) => id !== null && id === convergenceIds[0])
          ? convergenceIds[0]
          : null;
      if (!allEnd && !shared) {
        throw new Error(`条件节点 ${node.id} 的分支必须各自结束或汇聚到同一节点`);
      }

      const entries = node.data.branches.map((branch, index) => {
        const outcome = outcomes[index]!;
        const chainIds = [...outcome.ids];
        let step;
        if (chainIds.length === 0 && outcome.terminal.kind === 'end') {
          // 分支直连结束节点：用真实 end step，保证 end 模板被渲染
          step = makeStep(shape.node(targets[index]!));
        } else {
          // 其余情况（多节点链 / 内嵌条件 / 汇聚前导）统一走复合 step，
          // 由它渲染链上 end 模板并在汇聚点前停住
          step = makeCompositeStep(
            `branch-${branch.id}`,
            targets[index]!,
            outcome.terminal.kind === 'convergence' ? outcome.terminal.id : undefined,
          );
        }
        return [branchConditionFor(node.data.branches, index), step];
      });

      workflow = workflow.branch(entries as never) as Workflow;
      current = shared ?? null;
      continue;
    }

    // start / llm / tool
    const successors = shape.successors(current);
    if (successors.length === 0) {
      throw new Error(`节点 ${current} 的执行链到不了任何结束节点`);
    }
    if (successors.length > 1) {
      throw new Error(`节点 ${current} 存在多条出边：只有条件节点能分出分支`);
    }
    workflow = workflow.then(makeStep(node)) as Workflow;
    current = successors[0]!;
  }
  if (current !== null) {
    throw new Error('图过大，编译终止');
  }

  // 与 workflow 约定一致：只挂存储/tracing，不进注册表
  (workflow as unknown as { __registerMastra(m: Mastra): void }).__registerMastra(deps.mastra);
  // commit() 同步返回 Workflow；千万不能用 Promise.resolve 包裹——
  // Workflow 的 .then 是链式构建方法，会被当成 thenable 导致永远挂起。
  return workflow.commit();
}

// 复合解释器里的分支挑选：与 branchConditionFor 同一语义
async function pickBranch(node: WorkflowNode & { type: 'condition' }, resolve: OutputResolver): Promise<string> {
  const branches = node.data.branches;
  for (let index = 0; index < branches.length; index += 1) {
    const condition = branchConditionFor(branches, index);
    if (await condition({ getStepResult: (id: string) => resolveSafely(resolve, id) })) {
      const branch = branches[index]!;
      return branch.id;
    }
  }
  throw new Error(`条件节点 ${node.id} 没有命中任何分支，执行未能到达结束节点`);
}
