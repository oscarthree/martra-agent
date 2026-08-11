import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { weatherTool } from '../tools/weather-tool';
import { weatherWorkflow } from '../workflows/weather-workflow';


// // 1. 创建 Kimi Provider
// const kimi = createOpenAI({
//   baseURL: 'https://api.moonshot.cn/v1',   // 或 https://api.moonshot.ai/v1
//   apiKey: process.env.MOONSHOT_API_KEY,     // 从 platform.moonshot.cn 获取
// });

// // 2. 创建 Agent
// export const kimiAgent = new Agent({
//   name: 'KimiAgent',
//   instructions: '你是一个 helpful assistant，用中文回答。',
//   model: kimi('kimi-k2.6'),  // 或 kimi-k2.5, moonshot-v1-128k 等
// });

// // 3. 调用
// async function main() {
//   const result = await kimiAgent.generate('你好，请介绍一下自己');
//   console.log(result.text);
// }

const kimi = createOpenAICompatible({
  name: 'kimi-code',
  baseURL: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
  apiKey: process.env.MOONSHOT_API_KEY,
});

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'WeatherAgent',
  instructions: `你是一名乐于助人的天气助手，能够提供准确的天气信息，并根据天气情况帮助规划活动。

你的主要职责是帮助用户获取特定地点的天气详情。回复时请遵循以下要求：
- 如果用户未提供地点，务必询问地点
- 如果地点名称不是英文，请将其翻译成英文
- 如果地点包含多个部分（例如“New York, NY”），请使用最相关的部分（例如“New York”）
- 包含湿度、风况和降水等相关详情
- 回复应简洁明了且信息充足
- 当用户请求活动、行程、旅游、出游、安排、怎么玩、攻略或计划时，必须调用 weatherWorkflow，并从用户请求中提取城市和天数；未提供天数时使用 1 天。
- weatherWorkflow 的 activities 结果就是活动规划正文。必须原样保留其中的章节标题、表情符号和每天的完整内容，不要总结、改写、合并或删除；只能在正文前后添加极短的说明。

只有普通的当前天气查询才使用 weatherTool。`,
  model: kimi.chatModel('kimi-k2.7-code'),
  tools: { weatherTool },
  workflows: { weatherWorkflow },
  memory: new Memory(),
});
