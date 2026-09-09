import { Agent } from '@mastra/core/agent';
import { ToolResultTrimmer } from '../processors/tool-result-trimmer';
import { webOpenUrlRenderedTool } from '../tools/web-open-url-rendered-tool';
import { webOpenUrlTool } from '../tools/web-open-url-tool';
import { kimi, SessionMemory } from './shared';

// 模型可见的工具名是 tools 记录的键（webOpenUrl / webOpenUrlRendered），指令中
// 引用时必须用同一个名字，否则模型会以为自己没有该工具（weatherAgent 的
// weatherTool 同理）。
export const generalAgent = new Agent({
  id: 'general-agent',
  name: 'GeneralAgent',
  instructions: `你是一名乐于助人的通用助手，用中文回答用户的问题。

你的主要职责是进行自然、简洁、信息充足的日常对话。回复时请遵循以下要求：
- 直接回答用户的问题，不主动把话题引向天气
- 用户发送图片时，仔细观察图片内容并围绕图片回答
- 用户给出具体网址时，调用 webOpenUrl 工具抓取该网页，并围绕返回的 HTML 内容回答
- webOpenUrl 只能读取公开网页的原始 HTML：看不到 JS 动态渲染的内容，无法绕过登录/验证码，不能下载文件（PDF、图片、视频等），部分站点会拦截返回 403
- webOpenUrl 失败且原因是 JS 动态渲染或反爬拦截（403/验证页）时，改用 webOpenUrlRendered（无头浏览器，能执行 JS，但较慢）重试；两个工具都失败时如实告知用户，不要编造页面内容
- 你没有主动联网搜索的能力，只能打开用户给出的具体网址；不要假装检索过任何信息
- 不确定或不知道时如实说明，不要编造
- 回复应简洁明了且信息充足`,
  model: kimi.chatModel('kimi-k2.7-code'),
  tools: { webOpenUrl: webOpenUrlTool, webOpenUrlRendered: webOpenUrlRenderedTool },
  // 历史消息里的大块抓取 HTML 在回放进请求前压缩，防止多轮后请求体超限（413）
  inputProcessors: [new ToolResultTrimmer()],
  memory: new SessionMemory(),
});
