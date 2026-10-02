import { describe, expect, it, vi } from 'vitest';
import type { MastraDBMessage } from '@mastra/core/agent';
import { SessionMemory } from '../agents/shared';
import { WorkflowAgent } from './workflow-agent';

// 假编译产物：不跑真实 workflow，只按脚本返回 run 结果
function fakeWorkflow(
  result:
    | { status: 'success'; result: unknown }
    | { status: 'failed'; error: Error; steps?: Record<string, { status: string }> },
) {
  return {
    __registerMastra: () => {},
    createRun: async () => ({
      start: async () => result,
    }),
  };
}

const STREAM_OPTIONS = {
  runId: 'run-1',
  memory: { thread: 'thread-1', resource: 'res-1' },
};

async function collect(streamResult: { fullStream: ReadableStream<unknown> }) {
  const chunks: unknown[] = [];
  const stream = streamResult.fullStream as unknown as AsyncIterable<unknown>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function messagesOf(memory: SessionMemory): MastraDBMessage[] {
  const save = vi.mocked(memory.saveMessages).mock.calls[0]?.[0];
  return (save as { messages: MastraDBMessage[] } | undefined)?.messages ?? [];
}

describe('WorkflowAgent', () => {
  it('按原型实测形状合成 fullStream：text-delta × N（truthy payload）+ finish + close', async () => {
    const memory = new SessionMemory();
    vi.spyOn(memory, 'saveMessages').mockResolvedValue({ messages: [] });
    const agent = new WorkflowAgent({
      definition: { id: 'def-1', name: '测试助手' },
      workflow: fakeWorkflow({ status: 'success', result: '最终回复文本' }),
      memory,
    });

    const stream = await agent.stream(
      [{ id: 'm1', role: 'user', content: '你好' }],
      STREAM_OPTIONS,
    );
    const chunks = await collect(stream as { fullStream: ReadableStream<unknown> });

    const typed = chunks as Array<{ type: string; payload?: unknown; runId?: string }>;
    expect(typed.at(-1)?.type).toBe('finish');
    const deltas = typed.filter((chunk) => chunk.type === 'text-delta');
    expect(deltas.length).toBeGreaterThan(0);
    for (const delta of deltas) {
      expect(delta.runId).toBe('run-1');
      expect(delta.payload).toBeTruthy();
    }
    // 全部 delta 文本拼接 = workflow 最终输出
    const text = deltas
      .map((delta) => (delta.payload as { text: string }).text)
      .join('');
    expect(text).toBe('最终回复文本');
  });

  it('workflow 结果为对象（分支输出按 step id 合并）时取第一个值作为回复', async () => {
    const memory = new SessionMemory();
    vi.spyOn(memory, 'saveMessages').mockResolvedValue({ messages: [] });
    const agent = new WorkflowAgent({
      definition: { id: 'def-1', name: '测试助手' },
      workflow: fakeWorkflow({ status: 'success', result: { e1: '分支回复' } }),
      memory,
    });
    const stream = await agent.stream([{ role: 'user', content: 'hi' }], STREAM_OPTIONS);
    const chunks = await collect(stream as { fullStream: ReadableStream<unknown> });
    const text = (chunks as Array<{ type: string; payload?: { text: string } }>)
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => chunk.payload?.text ?? '')
      .join('');
    expect(text).toBe('分支回复');
  });

  it('成功时把用户消息与最终回复写入线程历史', async () => {
    const memory = new SessionMemory();
    const saveSpy = vi.spyOn(memory, 'saveMessages').mockResolvedValue({ messages: [] });
    const agent = new WorkflowAgent({
      definition: { id: 'def-1', name: '测试助手' },
      workflow: fakeWorkflow({ status: 'success', result: '回复' }),
      memory,
    });
    await agent.stream([{ id: 'm1', role: 'user', content: '问题' }], STREAM_OPTIONS);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = messagesOf(memory);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ role: 'user', threadId: 'thread-1', resourceId: 'res-1' });
    expect(saved[1]).toMatchObject({ role: 'assistant', threadId: 'thread-1', resourceId: 'res-1' });
  });

  it('workflow failed 时把失败节点名与错误说明作为回复文本，不写历史', async () => {
    const memory = new SessionMemory();
    const saveSpy = vi.spyOn(memory, 'saveMessages').mockResolvedValue({ messages: [] });
    const agent = new WorkflowAgent({
      definition: { id: 'def-1', name: '测试助手' },
      workflow: fakeWorkflow({
        status: 'failed',
        error: new Error('HTTP 503'),
        steps: { t1: { status: 'failed' }, s1: { status: 'success' } },
      }),
      memory,
    });
    const stream = await agent.stream([{ role: 'user', content: 'hi' }], STREAM_OPTIONS);
    const chunks = await collect(stream as { fullStream: ReadableStream<unknown> });
    const text = (chunks as Array<{ type: string; payload?: { text: string } }>)
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => chunk.payload?.text ?? '')
      .join('');
    expect(text).toContain('执行失败（节点 t1）');
    expect(text).toContain('HTTP 503');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('超过兜底超时时返回超时说明', async () => {
    const memory = new SessionMemory();
    vi.spyOn(memory, 'saveMessages').mockResolvedValue({ messages: [] });
    const hanging = {
      __registerMastra: () => {},
      createRun: async () => ({
        start: () => new Promise(() => {}),
      }),
    } as unknown as import('./workflow-agent').CompiledWorkflowHandle;
    const agent = new WorkflowAgent({
      definition: { id: 'def-1', name: '测试助手' },
      workflow: hanging,
      memory,
      timeoutMs: 50,
    });
    const stream = await agent.stream([{ role: 'user', content: 'hi' }], STREAM_OPTIONS);
    const chunks = await collect(stream as { fullStream: ReadableStream<unknown> });
    const text = (chunks as Array<{ type: string; payload?: { text: string } }>)
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => chunk.payload?.text ?? '')
      .join('');
    expect(text).toContain('超时');
  });

  it('用户消息取最后一条 user 消息的文本（数组 content 拼接文本 part）', async () => {
    const memory = new SessionMemory();
    vi.spyOn(memory, 'saveMessages').mockResolvedValue({ messages: [] });
    let capturedInput: unknown;
    const capturing = {
      __registerMastra: () => {},
      createRun: async () => ({
        start: async ({ inputData }: { inputData: unknown }) => {
          capturedInput = inputData;
          return { status: 'success', result: 'ok' };
        },
      }),
    };
    const agent = new WorkflowAgent({
      definition: { id: 'def-1', name: '测试助手' },
      workflow: capturing,
      memory,
    });
    await agent.stream(
      [
        { role: 'user', content: ' earlier' },
        {
          role: 'user',
          content: [{ type: 'text', text: '最新 ' }, { type: 'text', text: '问题' }],
        },
      ],
      STREAM_OPTIONS,
    );
    expect(capturedInput).toMatchObject({ userMessage: '最新 问题', threadId: 'thread-1', resourceId: 'res-1' });
  });
});
