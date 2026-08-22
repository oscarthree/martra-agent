import { Agent } from '@mastra/core/agent';
import { kimi, SessionMemory } from './shared';

export const generalAgent = new Agent({
  id: 'general-agent',
  name: 'GeneralAgent',
  instructions: `你是一名乐于助人的通用助手，用中文回答用户的问题。

你的主要职责是进行自然、简洁、信息充足的日常对话。回复时请遵循以下要求：
- 直接回答用户的问题，不主动把话题引向天气
- 用户发送图片时，仔细观察图片内容并围绕图片回答
- 不确定或不知道时如实说明，不要编造
- 回复应简洁明了且信息充足`,
  model: kimi.chatModel('kimi-k2.7-code'),
  memory: new SessionMemory(),
});
