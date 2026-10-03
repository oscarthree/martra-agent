# 处理器（Processors）

> C4 层级：**C4 Code**（贴近代码实现的消息预处理组件）。

## 1. 职责

`ToolResultTrimmer` 解决多轮对话后请求体过大的问题：

- 网页抓取工具返回的 HTML 可达 50,000 字符。
- 历史消息原样回放进请求体，几轮后可能超过 CopilotKit/LLM 的 body 限制。
- 该处理器在 `processInput` 阶段压缩历史消息中的工具结果，当前轮新结果不受影响。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/mastra/processors/tool-result-trimmer.ts` | 历史消息工具结果压缩器 |
| `src/mastra/processors/tool-result-trimmer.test.ts` | 单元测试 |

## 3. 关键类 / 函数

| 名称 | 作用 |
| --- | --- |
| `ToolResultTrimmer` | 实现 Mastra `Processor` 接口的输入处理器 |
| `trimText` | 将超过阈值的文本截断并附加压缩提示 |
| `trimResult` | 支持字符串结果或 `{ html: string }` 对象结果 |
| `processInput` | 遍历 `MessageList`，对 `tool-invocation` part 的结果进行压缩 |

## 4. 调用关系

```text
generalAgent
    │
    ├── inputProcessors: [ToolResultTrimmer]
    │
    └── 每次请求前
            │
            ▼
    ToolResultTrimmer.processInput(messageList)
            │
            └── 仅压缩历史消息中的 tool-invocation result
```

## 5. C4 Code：完整实现

```typescript
import type { MastraDBMessage, MessageList } from '@mastra/core/agent/message-list';
import type { Processor } from '@mastra/core/processors';

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

  async processInput(args: { messageList: MessageList }): Promise<MastraDBMessage[]> {
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
        return { ...part, toolInvocation: { ...invocation, result: trimmed } };
      });

      return changed ? { ...message, content: { ...content, parts } } : message;
    });
  }
}
```

## 6. 设计要点

- **只压缩历史**：`processInput` 在每次请求前处理已存储的历史消息，当前轮工具结果仍完整进入模型。
- **阈值 4,000 字符**：保留足够上下文锚点，同时显著降低请求体大小。
- **不可变性**：未超限时原样返回同一引用；超限时返回新对象，不修改原始消息。
- **只挂在 generalAgent**：`weatherTool` 结果较小，`weatherAgent` 无需压缩；`generalAgent` 的网页抓取会产生大段 HTML，是主要受益者。
