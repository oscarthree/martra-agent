# 验证受控附件接线与图片全链路

- Type: `wayfinder:prototype`
- Parent map: [通用多模态对话助手](../maps/general-multimodal-agent.md)
- Status: closed
- Blocking: 编写通用助手实现规格

## Question

受控 `CopilotChatView` 下用 `useAttachments` + `CopilotChatAttachmentQueue` / `CopilotChatAttachmentRenderer` 手动接线附件后，图片能否以 base64 经 AG-UI → `@ag-ui/mastra` → Mastra Agent → Moonshot 全链路跑通（模型实际"看到"图片并回答）？

顺带要在原型里确认的事实：

- AG-UI 消息里图片 part 的实际结构（字段名、data URL 形态）——决定本地快照降级时占位符替换哪个字段。
- 多轮对话中历史图片消息是否每次都被重新发给模型，对请求体积的影响。
- 大图（接近 20MB 附件上限）的发送行为与失败表现。

原型为一次性代码，放在 `prototype/` 下，不进主构建。

## Resolution

不再单独做一次性原型，改为在规格阶段收敛：

- 链路机制已由[多模态链路可行性研究](confirm-multimodal-chain-feasibility.md)从类型定义层面确认（CopilotKit 默认 base64 data URL、`toMastraContent` 自动转换图片 part、模型即视觉模型），无需补丁。
- 实时全链路验证（模型实际"看到"图片并回答）转为[通用助手实现规格](implement-general-assistant.md)的验收门槛：实现完成后必须在浏览器中实际发图问答通过，才视为完成。
- 快照降级的占位符决策不再依赖原型实测结构：统一约定为"持久化前将 image/binary content part 替换为文本占位 part"，已写入规格。
- 多轮历史图片重复上行的体积开销本轮接受；大图体验留作后续调优。
