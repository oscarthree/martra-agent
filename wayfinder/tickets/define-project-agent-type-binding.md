# 定义项目 Agent 类型绑定与工作区状态扩展

- Type: `wayfinder:grilling`
- Parent map: [通用多模态对话助手](../maps/general-multimodal-agent.md)
- Status: closed
- Blocking: 编写通用助手实现规格

## Question

项目级 agent 类型绑定如何落到工作区状态模型和 UI：

- `project` 的 agent 类型字段形状：字段名、枚举值、默认值（现有项目升级后算哪种类型）？
- localStorage 快照 schema 从 v1（`weather-copilot-workspace-v1`）升级的迁移策略：是原地升级还是换键？
- 新建项目弹窗里的类型选择交互长什么样，创建后是否可改？
- `useAgent` 的 `runtimeAgentId` 如何按当前会话所属项目的类型取值，切换项目时正在进行的会话怎么办？
- `CONTEXT.md` 需要新增哪些术语（通用助手、项目类型等）并更新哪些已有定义？

用 `/grilling` + `/domain-modeling` 推进。

## Resolution

在 `/to-spec` 规格整理阶段按既有约定收敛，决策已并入[通用助手实现规格](implement-general-assistant.md)：

- 字段形状：`Project` 与 `Session` 都新增 `agentType: "weather" | "general"`。Session 在创建时从所属项目捕获类型（反规范化），项目删除进入未分类后会话路由不变；现有 v1 数据全部视为 `"weather"`。
- 迁移策略：原地升级。存储 key 保持 `weather-copilot-workspace-v1` 不变（换键会孤立用户已有数据），状态版本升到 2，加载时由纯迁移函数先升级再校验；解析失败或未知版本走既有恢复路径（保留内存状态、清除损坏数据、重建默认工作区、轻量提示）。
- 新建项目弹窗：增加助手类型选择（天气助手 / 通用助手，默认天气助手），创建后不可改，重命名弹窗不暴露类型。
- `runtimeAgentId`：由当前会话的 `agentType` 推导（`"weatherAgent"` / `"generalAgent"`，即 Mastra 注册键）。client 侧 agent id 本就按会话隔离，会话生命周期内不切换 runtime agent；切换活动项目不影响当前会话（沿用既有生命周期规则）。
- `CONTEXT.md`：新增"通用助手"与"项目 Agent 类型"术语，并更新 Project / Session 定义提及类型绑定（随实现一并提交）。
