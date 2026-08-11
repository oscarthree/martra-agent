import { Agent } from '@mastra/core/agent';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const kimi = createOpenAICompatible({
  name: 'kimi-code',
  baseURL: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
  apiKey: process.env.MOONSHOT_API_KEY,
});

export const activityPlannerAgent = new Agent({
  id: 'activity-planner-agent',
  name: 'ActivityPlannerAgent',
  instructions:
    '你是活动规划专家。必须严格按照用户提供的模板输出，不要删除、合并或改写章节标题和表情符号。只根据输入的天气预报生成与地点相关的活动安排。',
  model: kimi.chatModel('kimi-k2.7-code'),
});
