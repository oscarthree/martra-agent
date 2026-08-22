# 确认多模态链路可行性

- Type: `wayfinder:research`
- Parent map: [通用多模态对话助手](../maps/general-multimodal-agent.md)
- Status: closed
- Blocking: 验证受控附件接线与图片全链路、编写通用助手实现规格

## Question

新增"通用对话 + 图片理解" agent 所需的三段链路是否各自具备能力：Moonshot 是否有视觉模型且收什么格式的图片、`@mastra/core` 的 Agent 是否支持多模态消息、CopilotKit v2 受控 `CopilotChatView` 是否有附件上传能力？

## Resolution

**可行，无需补丁。**

- **Moonshot**：当前硬编码的 `kimi-k2.7-code` 本身就是视觉模型，收 OpenAI 标准 `image_url` content part（`{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}`）。重要限制：图片只支持 base64 内联或文件上传引用，**不支持 URL 形式图片**；单请求体上限 100M，建议图片不超 4K。文档：https://platform.kimi.ai/docs/guide/use-kimi-vision-model
- **Mastra**（`@mastra/core@1.51.0`）：`Agent.stream/generate` 的 messages 参数 `MessageListInput` 原生支持 AI SDK 的 `ImagePart`/`FilePart`，并内置 `attachmentsToParts()` 转换 `experimental_attachments`（`dist/agent/message-list/prompt/attachments-to-parts.d.ts`）。
- **CopilotKit v2**（`@copilotkit/react-core@1.66` / `react-ui@1.66.4`）：内置完整附件能力（拖放、队列、渲染），默认上传为 base64 data URL（正好匹配 Moonshot 限制）。受控 `CopilotChatView` 不能直接传 `AttachmentsConfig`，需用 `useAttachments` hook（含 `consumeReadyAttachments`）+ `CopilotChatAttachmentQueue` / `CopilotChatAttachmentRenderer` 手动接线。
- **AG-UI 适配**（`@ag-ui/mastra@1.1.1`）：`toMastraContent` 会把 AG-UI 消息里的 `image`/`binary` content 转成 Mastra 的 `{type:'image', image:'data:...;base64,...'}` part，直接喂给 agent。
