import { Memory } from '@mastra/memory';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Each workspace session runs as its own Mastra thread. A brand-new thread has
// no row in storage yet, and @mastra/memory's recall() throws for unknown
// threads instead of returning empty — which makes the AG-UI adapter log a
// "Failed to compute new-message diff" warning on every session's first run.
// Recall on a missing thread is legitimately empty, so soften just that case.
export class SessionMemory extends Memory {
  override async recall(
    args: Parameters<Memory["recall"]>[0],
  ): ReturnType<Memory["recall"]> {
    try {
      return await super.recall(args);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No thread found")) {
        return { messages: [], total: 0, page: 0, perPage: false, hasMore: false };
      }
      throw error;
    }
  }
}

// Shared Moonshot provider. The hardcoded model is a vision model, so both the
// weather agent and the general agent use this single definition.
export const kimi = createOpenAICompatible({
  name: 'kimi-code',
  baseURL: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
  apiKey: process.env.MOONSHOT_API_KEY,
});
