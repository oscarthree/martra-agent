# 通用多模态对话助手

## Destination

形成一份可直接交给实现阶段执行的决策（ready-for-agent 规格）：在本仓库并列新增"通用助手" agent（`generalAgent`），支持文本闲聊和图片理解（输入侧多模态），与 `weatherAgent` 并存，项目级绑定 agent 类型。规格产出后走 `/to-spec` → tickets → `/implement`。

## Notes

领域：通用对话、多模态（图片理解）、工作区项目/会话模型（术语见 `CONTEXT.md`）、CopilotKit v2 受控接线。

本地图只产出决策，不直接实现功能。Mastra 相关改动前必须先加载 `mastra` skill（远端不可用则核对 node_modules 类型定义）。前端自定义样式变量一律用 `--wc-*` 前缀。新增 agent 必须在 `src/mastra/index.ts` 注册。

## Decisions so far

- 已在对话中确认：并列新增通用助手，不改动 `weatherAgent` 和现有天气链路。
- 已在对话中确认：多模态范围只做图片理解（输入侧）；图片生成、语音、文档解析不做。
- 已在对话中确认：agent 绑定在项目级——新建项目时选类型（天气助手 / 通用助手），项目下所有会话走对应 agent。
- 已在对话中确认：图片消息本地快照降级——localStorage 快照里图片只存占位符，刷新后历史图片不可见；IndexedDB 方案留作后续。
- 已在对话中确认：通用助手复用现有 `SessionMemory` 机制（同一 resource-id，`threadId = session.id`），不做跨会话长期记忆。
- 已在对话中确认：命名"通用助手"，代码标识符 `generalAgent` / `general-agent.ts`。
- 已在对话中确认：模型不变——`kimi-k2.7-code` 本身就是视觉模型，收 OpenAI 标准 `image_url` part（仅 base64，不收 URL 图片）。
- 已在对话中确认：图片原图直发，不做前端压缩；压缩优化凭实际体验再决策。
- 已在对话中确认：空状态文案按项目类型区分，通用助手项目显示通用欢迎语。
- [确认多模态链路可行性](../tickets/confirm-multimodal-chain-feasibility.md) — 当前 Moonshot 模型即视觉模型、Mastra 原生支持多模态消息、CopilotKit v2 内置附件能力（受控视图需 `useAttachments` 手动接线），全链路无需补丁。

## Not yet specified

- 大图体验：原图直发在多大尺寸下开始明显变慢，何时引入前端压缩。
- 通用助手未来是否需要工具能力（联网搜索等），目前定位纯对话。
- 历史消息里图片占位符的具体渲染样式和文案。
- 视频输入（模型侧已支持，本轮不铺开）。

## Out of scope

- 图片生成、语音输入输出、文档解析等图片理解之外的多模态方向。
- 改造 `weatherAgent`（包括让它获得看图能力）。
- 跨浏览器、跨设备或账号级同步；服务端附件存储。
