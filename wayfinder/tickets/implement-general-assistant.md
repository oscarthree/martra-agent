# 编写通用助手实现规格

- Type: `wayfinder:task`
- Parent map: [通用多模态对话助手](../maps/general-multimodal-agent.md)
- Status: open
- Blocked by: 验证受控附件接线与图片全链路、定义项目 Agent 类型绑定与工作区状态扩展

## Question

把本地图的全部已确认决策收敛成一份 ready-for-agent 实现规格，可直接交给 `/to-spec` → tickets → `/implement` 执行。规格至少覆盖：

- `generalAgent` 定义（中文指令、纯对话无工具、复用 `SessionMemory`）并在 `src/mastra/index.ts` 注册
- 项目类型绑定与工作区状态迁移（依据"定义项目 Agent 类型绑定"ticket 的结论）
- 受控 `CopilotChatView` 附件接线方案（依据"验证受控附件接线"原型的结论）
- 图片消息本地快照降级格式（占位符结构、刷新后的展示文案）
- 按项目类型区分的空状态文案
- 验收标准（pnpm test、tsc、浏览器实际发图问答）
