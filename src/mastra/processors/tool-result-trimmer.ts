import type {
  MastraDBMessage,
  MessageList,
} from '@mastra/core/agent/message-list';
import type { Processor } from '@mastra/core/processors';

// 历史消息自动压缩：网页抓取工具的 html 字段可达 50,000 字符，整条历史原样
// 回放进请求体，几轮之后就打爆 body 限制（413）。模型回答旧轮次早已完成，
// 历史里的大块工具结果只需保留开头做上下文锚点。本处理器只跑在 processInput
// （历史消息回放）阶段，当前轮新产生的工具结果不受影响。
const MAX_TOOL_RESULT_CHARS = 4_000;

function trimText(text: string): string {
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[历史内容过长，已自动压缩，原始共 ${text.length} 字符]`;
}

function trimResult(result: unknown): unknown {
  if (typeof result === 'string') {
    return result.length > MAX_TOOL_RESULT_CHARS ? trimText(result) : result;
  }
  if (result && typeof result === 'object' && 'html' in result) {
    const html = (result as { html?: unknown }).html;
    if (typeof html === 'string' && html.length > MAX_TOOL_RESULT_CHARS) {
      return { ...result, html: trimText(html) };
    }
  }
  return result;
}

export class ToolResultTrimmer implements Processor {
  readonly id = 'tool-result-trimmer';
  name = 'ToolResultTrimmer';

  async processInput(args: {
    messageList: MessageList;
  }): Promise<MastraDBMessage[]> {
    const messages = args.messageList.get.all.db();

    return messages.map((message) => {
      const content = message.content;
      if (typeof content === 'string' || !content?.parts) return message;

      let changed = false;
      const parts = content.parts.map((part) => {
        if (part.type !== 'tool-invocation') return part;
        const invocation = part.toolInvocation;
        const trimmed = trimResult(invocation.result);
        if (trimmed === invocation.result) return part;
        changed = true;
        return {
          ...part,
          toolInvocation: { ...invocation, result: trimmed },
        };
      });

      // 不需要压缩时原样返回，避免无谓的对象拷贝
      return changed ? { ...message, content: { ...content, parts } } : message;
    });
  }
}
