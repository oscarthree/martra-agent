import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import type { MastraDBMessage } from '@mastra/core/agent';
import { SessionMemory } from '../agents/shared';
import { disposeRunOutputs, type WorkflowInit } from './compile';

// WorkflowAgent：每个自定义 Agent 定义的动态执行体。
// 覆写 stream() 执行编译好的 workflow（run.start 等终态 + 兜底超时），
// 把最终文本按原型实测的 chunk 形状合成为 fullStream 返回给 AG-UI 适配器。
// 构造器 model 传 {}（构造器只 truthy 检查；stream 覆写后模型不会被触达）。

export interface WorkflowAgentDefinition {
  id: string;
  name: string;
}

export interface CompiledWorkflowHandle {
  __registerMastra(mastra: unknown): void;
  createRun(options?: {
    resourceId?: string;
    runId?: string;
  }): Promise<{
    start(args: { inputData: WorkflowInit }): Promise<WorkflowRunOutcome>;
  }>;
}

export interface WorkflowRunOutcome {
  status: string;
  result?: unknown;
  error?: Error;
}

export interface WorkflowAgentOptions {
  definition: WorkflowAgentDefinition;
  workflow: CompiledWorkflowHandle;
  memory?: SessionMemory;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const TEXT_CHUNK_SIZE = 16;

export class WorkflowAgent extends Agent {
  private readonly workflowHandle: CompiledWorkflowHandle;
  private readonly definitionName: string;
  private readonly timeoutMs: number;

  constructor(options: WorkflowAgentOptions) {
    super({
      id: `custom-agent-${options.definition.id}`,
      name: options.definition.name,
      instructions: '',
      model: {} as never,
      memory: options.memory ?? new SessionMemory(),
    });
    this.workflowHandle = options.workflow;
    this.definitionName = options.definition.name;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  override async stream(messages: unknown, options?: Record<string, unknown>) {
    const opts = options as
      | { runId?: string; memory?: { thread?: string; resource?: string } }
      | undefined;
    const runId = opts?.runId ?? randomUUID();
    const threadId = opts?.memory?.thread ?? 'default-thread';
    const resourceId = opts?.memory?.resource ?? 'default';

    const userMessage = lastUserMessageText(messages);
    let finalText: string;

    try {
      // runId 显式传给 workflow run：节点 step 的 runOutputs 以同一 runId 登记与清理
      const run = await this.workflowHandle.createRun({ resourceId, runId });
      const outcome = await withTimeout(
        run.start({ inputData: { userMessage, threadId, resourceId } }),
        this.timeoutMs,
      );
      if (outcome.status === 'success') {
        finalText = extractResultText(outcome.result);
        if (!finalText) {
          finalText = `自定义 Agent「${this.definitionName}」执行完成，但没有产生任何回复文本。`;
        }
        await this.persistExchange(threadId, resourceId, userMessage, finalText);
      } else {
        const detail = outcome.error?.message ?? '未知错误';
        finalText = `自定义 Agent「${this.definitionName}」执行失败（节点 ${failedStepName(outcome)}）：${detail}`;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      finalText = `自定义 Agent「${this.definitionName}」执行失败：${detail}`;
    } finally {
      disposeRunOutputs(runId);
    }

    return synthesizeStream(runId, finalText) as never;
  }

  // 外层 agent 正常读写线程：用户消息与最终回复进历史（与现有会话一致）。
  // 失败路径不写历史；保存失败只记日志，不影响当次回复。
  private async persistExchange(
    threadId: string,
    resourceId: string,
    userMessage: string,
    assistantText: string,
  ): Promise<void> {
    try {
      const memory = await this.getMemory();
      if (!memory) return;
      const now = new Date();
      const toMessage = (role: 'user' | 'assistant', text: string): MastraDBMessage => ({
        id: randomUUID(),
        role,
        createdAt: now,
        threadId,
        resourceId,
        content: { format: 2, parts: [{ type: 'text', text }] },
      });
      await memory.saveMessages({
        messages: [toMessage('user', userMessage), toMessage('assistant', assistantText)],
      });
    } catch (error) {
      console.error('custom agent history persist failed:', error);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`执行超时（${timeoutMs / 1000} 秒）`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// 分支输出按 step id 合并时 result 是对象（只有一个分支真正执行）；
// 纯线性链上是字符串。取唯一值，空值交给上层兜底。
function extractResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const values = Object.values(result).filter((value) => typeof value === 'string');
    return values[0] ?? '';
  }
  return '';
}

// 从失败结果里找第一个失败的 step，把节点 id 亮在错误说明里（规格 §4.6）
function failedStepName(outcome: WorkflowRunOutcome): string {
  const steps = (outcome as { steps?: Record<string, { status?: string }> }).steps;
  if (steps && typeof steps === 'object') {
    const failed = Object.entries(steps).find(([, step]) => step?.status === 'failed');
    if (failed) return failed[0];
  }
  return '未知';
}

function lastUserMessageText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown } | undefined;
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter(
          (part): part is { type: string; text: string } =>
            !!part && typeof part === 'object' && (part as { type?: string }).type === 'text',
        )
        .map((part) => part.text)
        .join('');
    }
    return '';
  }
  return '';
}

// 原型实测的合成流形状（.scratch/prototype-workflow-agent.ts）：
// 普通对象 { fullStream, traceId } + as cast；text-delta 必须带 truthy payload，
// 否则被适配器静默跳过；finish payload 字段不被读取。
function synthesizeStream(runId: string, text: string) {
  const messageId = randomUUID();
  const fullStream = new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < text.length; offset += TEXT_CHUNK_SIZE) {
        controller.enqueue({
          type: 'text-delta',
          runId,
          from: 'AGENT',
          payload: { id: messageId, text: text.slice(offset, offset + TEXT_CHUNK_SIZE) },
        });
      }
      controller.enqueue({ type: 'finish', runId, from: 'AGENT', payload: {} });
      controller.close();
    },
  });
  return { fullStream, traceId: runId };
}
