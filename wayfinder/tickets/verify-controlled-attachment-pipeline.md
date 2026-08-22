# 验证受控附件接线与图片全链路

- Type: `wayfinder:prototype`
- Parent map: [通用多模态对话助手](../maps/general-multimodal-agent.md)
- Status: open
- Blocking: 编写通用助手实现规格

## Question

受控 `CopilotChatView` 下用 `useAttachments` + `CopilotChatAttachmentQueue` / `CopilotChatAttachmentRenderer` 手动接线附件后，图片能否以 base64 经 AG-UI → `@ag-ui/mastra` → Mastra Agent → Moonshot 全链路跑通（模型实际"看到"图片并回答）？

顺带要在原型里确认的事实：

- AG-UI 消息里图片 part 的实际结构（字段名、data URL 形态）——决定本地快照降级时占位符替换哪个字段。
- 多轮对话中历史图片消息是否每次都被重新发给模型，对请求体积的影响。
- 大图（接近 20MB 附件上限）的发送行为与失败表现。

原型为一次性代码，放在 `prototype/` 下，不进主构建。
