# 定义项目 Agent 类型绑定与工作区状态扩展

- Type: `wayfinder:grilling`
- Parent map: [通用多模态对话助手](../maps/general-multimodal-agent.md)
- Status: open
- Blocking: 编写通用助手实现规格

## Question

项目级 agent 类型绑定如何落到工作区状态模型和 UI：

- `project` 的 agent 类型字段形状：字段名、枚举值、默认值（现有项目升级后算哪种类型）？
- localStorage 快照 schema 从 v1（`weather-copilot-workspace-v1`）升级的迁移策略：是原地升级还是换键？
- 新建项目弹窗里的类型选择交互长什么样，创建后是否可改？
- `useAgent` 的 `runtimeAgentId` 如何按当前会话所属项目的类型取值，切换项目时正在进行的会话怎么办？
- `CONTEXT.md` 需要新增哪些术语（通用助手、项目类型等）并更新哪些已有定义？

用 `/grilling` + `/domain-modeling` 推进。
