# 01 — 后端并列注册通用助手 agent

**What to build:** 用户可以通过 CopilotKit 运行时与一个新的"通用助手" agent 对话：它用中文纯对话回答，不带任何天气工具或工作流，不做天气意图路由。它与 `weatherAgent` 并存，现有天气链路行为完全不变。两个 agent 共享同一份 Moonshot provider 配置和同一个 `SessionMemory` 机制（同一 Resource Identity、`threadId = session.id`、新线程 recall 软化为空的保护保留），而不是各抄一份。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 共享 provider 与 `SessionMemory` 被提取为单一来源，weather agent 改为复用它，且 `weatherAgent` 的指令、工具、工作流、记忆行为无任何变化
- [ ] `generalAgent`（agent id `general-agent`）定义完成：中文指令、纯对话、无工具无工作流、模型不变（`kimi-k2.7-code`）、记忆使用共享 `SessionMemory`
- [ ] `generalAgent` 注册进 Mastra 实例的 agents map（键名 `generalAgent`），Express 入口与 `/api/copilotkit` 路由零改动即可通过 `MastraAgent.getLocalAgents` 暴露
- [ ] 新增 agent 定义形态单测：注册键正确、无工具/工作流配置、记忆为共享 `SessionMemory`；不发起任何网络或模型调用
- [ ] `pnpm test` 与 `pnpm exec tsc --noEmit` 通过
- [ ] 实现前已按项目 AGENTS.md 要求加载 `mastra` skill（远端不可用则核对 node_modules 类型定义）
