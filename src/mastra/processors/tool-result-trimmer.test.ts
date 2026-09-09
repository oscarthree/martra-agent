import { describe, expect, it } from 'vitest';
import type { MastraDBMessage } from '@mastra/core/agent/message-list';
import { ToolResultTrimmer } from './tool-result-trimmer';

function messageWithToolResult(result: unknown): MastraDBMessage {
  return {
    id: 'm1',
    role: 'assistant',
    createdAt: new Date(),
    type: 'text',
    content: {
      format: 2,
      parts: [
        {
          type: 'tool-invocation',
          toolInvocation: {
            state: 'result',
            toolCallId: 'c1',
            toolName: 'webOpenUrl',
            args: { url: 'https://example.com' },
            result,
          },
        },
      ],
    },
  } as unknown as MastraDBMessage;
}

function textMessage(text: string): MastraDBMessage {
  return {
    id: 'm2',
    role: 'user',
    createdAt: new Date(),
    type: 'text',
    content: { format: 2, parts: [{ type: 'text', text }] },
  } as unknown as MastraDBMessage;
}

async function run(messages: MastraDBMessage[]): Promise<MastraDBMessage[]> {
  const messageList = { get: { all: { db: () => messages } } };
  return await new ToolResultTrimmer().processInput({
    messageList: messageList as never,
  });
}

describe('ToolResultTrimmer', () => {
  it('trims oversized html fields in historical tool results', async () => {
    const bigHtml = 'x'.repeat(50_000);
    const [result] = await run([
      messageWithToolResult({ ok: true, url: 'https://example.com', html: bigHtml }),
    ]);

    const part = (result as MastraDBMessage).content.parts[0] as never as {
      toolInvocation: { result: { html: string; ok: boolean } };
    };
    expect(part.toolInvocation.result.ok).toBe(true);
    expect(part.toolInvocation.result.html.length).toBeLessThan(5_000);
    expect(part.toolInvocation.result.html).toContain('已自动压缩');
    expect(part.toolInvocation.result.html.startsWith('xxxx')).toBe(true);
  });

  it('trims oversized string results', async () => {
    const [result] = await run([messageWithToolResult('y'.repeat(10_000))]);
    const part = (result as MastraDBMessage).content.parts[0] as never as {
      toolInvocation: { result: string };
    };
    expect(part.toolInvocation.result.length).toBeLessThan(5_000);
  });

  it('leaves small results and plain text messages untouched (same reference)', async () => {
    const small = messageWithToolResult({ ok: true, html: '<html>short</html>' });
    const text = textMessage('你好');
    const [r1, r2] = await run([small, text]);

    expect(r1).toBe(small);
    expect(r2).toBe(text);
  });

  it('does not mutate the stored message objects', async () => {
    const bigHtml = 'z'.repeat(50_000);
    const original = messageWithToolResult({ ok: true, html: bigHtml });
    await run([original]);

    const part = original.content.parts[0] as never as {
      toolInvocation: { result: { html: string } };
    };
    expect(part.toolInvocation.result.html).toHaveLength(50_000);
  });
});
