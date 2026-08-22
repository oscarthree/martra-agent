# 编写通用助手实现规格

- Type: `wayfinder:spec`
- Status: `ready-for-agent`
- Labels: `ready-for-agent`
- Parent map: [通用多模态对话助手](../maps/general-multimodal-agent.md)
- Blocking decisions:
  - [确认多模态链路可行性](confirm-multimodal-chain-feasibility.md)
  - [定义项目 Agent 类型绑定与工作区状态扩展](define-project-agent-type-binding.md)
  - [验证受控附件接线与图片全链路](verify-controlled-attachment-pipeline.md)

## Problem Statement

Weather Copilot 目前只有天气助手一种对话能力：所有会话都路由到 `weatherAgent`，用户无法进行不带天气工具的普通闲聊，也无法让模型看图回答问题。工作区的 Project 没有类型概念，新建项目时不能选择助手类型，已有的 v1 本地工作区数据也没有承载这一信息的字段。

链路能力已经确认就绪：当前模型本身就是视觉模型（仅收 base64 内联图片），Mastra 原生支持多模态消息，CopilotKit v2 内置附件能力，`@ag-ui/mastra` 会自动转换图片 content part——缺的是把这一切接起来的决策落地。

## Solution

并列新增一个纯对话的通用助手 agent（`generalAgent`），与 `weatherAgent` 并存，不改动现有天气链路。Project 获得不可变的 Agent 类型（天气助手 / 通用助手），新建项目时选择，项目下所有 Session 走对应 agent；Session 在创建时捕获所属项目的类型，项目删除后进入未分类也不改变其 agent 路由。

浏览器工作区状态从 v1 原地迁移到 v2（存储 key 不变），为 Project 和 Session 补上类型字段，已有数据全部视为天气助手类型。通用助手项目的会话启用图片附件（base64 原图直发，不压缩）；本地消息快照中图片数据降级为占位符，刷新后历史图片不可见但对话文字完整保留。

## User Stories

1. As a Weather Copilot user, I want to choose an assistant type when creating a project, so that the project's conversations use the assistant that fits my task.
2. As a Weather Copilot user, I want the weather assistant to be the default type for new projects, so that the existing weather-first workflow is not slowed down.
3. As a Weather Copilot user, I want a general-assistant project to offer plain conversation without weather tools, so that casual questions are answered directly without weather intent routing.
4. As a Weather Copilot user, I want a project's assistant type to be fixed after creation, so that conversations within a project never silently change behavior.
5. As a Weather Copilot user, I want every session in a project to use the project's assistant type, so that behavior is predictable across the project.
6. As a Weather Copilot user, I want a session to keep its assistant type when its project is deleted, so that an Unclassified Session continues with the same assistant it started with.
7. As a Weather Copilot user, I want switching the Active Project not to change the assistant of the session I am currently viewing, so that my ongoing conversation stays stable.
8. As a Weather Copilot user, I want my existing projects and sessions to work unchanged after the upgrade, so that no weather conversation or history is lost.
9. As a Weather Copilot user, I want my pre-upgrade projects to behave as weather-assistant projects, so that the upgrade never changes what my existing work does.
10. As a Weather Copilot user, I want the general assistant to answer in Chinese, so that the conversation matches the rest of the product.
11. As a general-assistant user, I want to attach an image to a message, so that I can ask questions about what the image shows.
12. As a general-assistant user, I want to attach an image by dragging it into the chat, so that I do not have to browse through a file dialog.
13. As a general-assistant user, I want to see queued attachments before sending, so that I can confirm or remove the wrong image.
14. As a general-assistant user, I want to send text together with an image in one message, so that I can phrase my question about the image naturally.
15. As a general-assistant user, I want the model to actually see my image and answer about its content, so that image understanding works end to end.
16. As a general-assistant user, I want to continue a multi-turn conversation after sending an image, so that follow-up questions keep the conversation context.
17. As a general-assistant user, I want my image sent at its original quality, so that small details in the picture remain visible to the model.
18. As a general-assistant user, I want an oversized or failed attachment to surface a clear error, so that I understand why my message did not go through.
19. As a general-assistant user, I want image messages to survive in the live session view, so that I can see what I sent while the conversation continues.
20. As a general-assistant user, I want a page reload to restore my conversation text, so that my chat history is not lost on refresh.
21. As a general-assistant user, I want restored history to show a placeholder where an image was, so that I understand an image existed there even though it was not stored locally.
22. As a general-assistant user, I want image data kept out of browser storage, so that a few photos do not exhaust the localStorage quota.
23. As a general-assistant user, I want a storage-quota failure to keep my in-memory workspace intact with a lightweight notice, so that a full disk never breaks the UI.
24. As a Weather Copilot user, I want weather-assistant sessions to show no attachment controls, so that the weather experience stays exactly as it is today.
25. As a Weather Copilot user, I want the general assistant to remember earlier turns within the same session, so that follow-up questions work like they do with the weather assistant.
26. As a Weather Copilot user, I want the general assistant to use the same server-side Resource Identity mechanism, so that memory behavior is consistent and no new backend identity is introduced.
27. As a Weather Copilot user, I want a general-assistant project to show a general welcome message when empty, so that the empty state does not push weather suggestions at an unrelated task.
28. As a Weather Copilot user, I want a weather project to keep its existing welcome and suggested prompts, so that the weather onboarding is unchanged.
29. As a Weather Copilot user, I want session history, renaming, deletion, grouping, and project operations to work identically in general-assistant projects, so that workspace management needs no relearning.
30. As a Weather Copilot user, I want corrupted or unrecognizable local workspace data to still recover to a valid default workspace, so that the v2 upgrade does not weaken existing failure handling.

## Implementation Decisions

- **New general agent module.** A new agent named `generalAgent` (agent id `general-agent`) is defined alongside the existing weather agent: Chinese instructions, pure conversation, no tools and no workflows, same Moonshot OpenAI-compatible provider and same hardcoded model (`kimi-k2.7-code`, which is itself the vision model). It reuses the existing `SessionMemory` class — including the "No thread found" recall softening, which must not be removed — so memory semantics are identical to the weather agent (same Resource Identity, `threadId = session.id`, no cross-session long-term memory). The shared provider and `SessionMemory` are factored so both agents use one definition rather than a copy.
- **Mastra registration only; no server-route changes.** `generalAgent` is registered in the Mastra instance's `agents` map under the key `generalAgent`. The existing `MastraAgent.getLocalAgents` call exposes every registered agent through the CopilotKit runtime automatically, so the Express entry and `/api/copilotkit` route stay untouched.
- **Agent type lives on both Project and Session.** `Project` gains `agentType: "weather" | "general"`, set at creation and immutable afterward (no UI to change it). `Session` gains `agentType` captured from its owning project at creation time; this denormalization is what lets an Unclassified Session keep its assistant after project deletion, and what keeps the current session stable when the Active Project changes.
- **Runtime agent selection is per session.** The chat component derives `runtimeAgentId` from the active session's `agentType` (`"weatherAgent"` / `"generalAgent"` — the Mastra registration keys). Because the client-side agent id is already per-session, a session never switches runtime agent mid-life; no in-flight run migration is needed.
- **Workspace storage migrates in place, key unchanged.** The localStorage key stays `weather-copilot-workspace-v1` (renaming it would orphan existing user data). The state version bumps to 2, and a pure migration function upgrades v1 payloads before validation by stamping `agentType: "weather"` onto every project and session. Payloads that fail JSON parsing, fail validation, or carry an unknown version follow the existing recovery path: keep in-memory state, clear the corrupt entry, rebuild the default workspace, show one lightweight notice.
- **New-project dialog gains a type choice.** The existing lightweight centered dialog gets an assistant-type selector (two options: 天气助手 / 通用助手) defaulting to 天气助手; name validation and error behavior are unchanged. Type selection also applies to any other project-creation entry point. The rename-project flow does not expose the type.
- **Attachments only for general-assistant sessions.** The controlled chat view wires CopilotKit's `useAttachments` hook with the attachment queue and renderer components manually (the controlled view cannot take an attachments config directly). The attachment UI is rendered only when the active session's `agentType` is `"general"`; weather sessions render exactly as today. CopilotKit's default base64 data-URL upload is used as-is — it matches the model's base64-only constraint, and `@ag-ui/mastra` already converts AG-UI image content into Mastra multimodal parts. Images are sent at original size with no client-side compression.
- **Image snapshot downgrade.** Before persisting a session's messages to localStorage, a sanitizer replaces every image/binary content part with a text placeholder part, so stored snapshots stay schema-valid and small. Restored history renders that placeholder as muted inline copy conveying "image not stored locally" (exact wording finalized at implementation). A restored placeholder therefore reaches the model as ordinary text if the conversation continues — accepted behavior, not a bug. The live (pre-reload) session view keeps real images.
- **Type-aware empty states.** The empty-project/empty-session welcome branches on the session's agent type: weather keeps the current welcome plus suggested prompts; general shows a general-assistant welcome without weather suggestions. The input area stays available in both, per the existing visual contract.
- **Domain vocabulary updates.** The implementation adds the new domain terms to the project glossary (at minimum: 通用助手 / General Assistant, and Project Agent Type) and adjusts existing Project and Session definitions to mention the type binding. The workspace state boundary stays the single frontend persistence seam.
- **Attachment chain verification is an acceptance gate, not a prerequisite.** The mechanism is confirmed by the feasibility research ticket; the live end-to-end check (model actually answers about the image) is part of acceptance below and must pass before the implementation is considered done.

## Testing Decisions

- **What makes a good test:** test external behavior of pure modules only — state transitions, migration output, validation rejection, agent configuration shape. No mocking of the model, no network calls, no DOM rendering tests; this matches the repo's existing convention that network and model calls get no integration tests.
- **Automated seam (one, existing):** colocated Vitest unit tests.
  - The workspace state module is tested for: v1→v2 migration (every project/session stamped `weather`; sessions, titles, snapshots, active ids preserved), v2 round-trip serialize/parse, rejection of unknown versions and invalid `agentType` values, `agentType` capture on session creation, type survival through project deletion into Unclassified, and unchanged behavior of existing lifecycle functions. Prior art: the existing workspace-state test file (pure functions with injected `now`/`createId`).
  - The general agent module is tested for definition shape: registered under the expected key, no tools/workflows configured, and memory provided by the shared `SessionMemory`. Prior art: the workflow test file, which asserts schema/definition shape without executing anything.
- **Manual acceptance (no automated seam):** the image round-trip is verified in the browser — start backend and frontend, create a general-assistant project, send an image with a question, confirm the model answers about the image content. Also covered manually: attachment UI absent in weather projects, drag-and-drop attach, placeholder after reload, v1 data migrating on load, and type-aware empty states.

## Out of Scope

- 图片生成、语音输入输出、文档解析、视频输入等图片理解之外的多模态方向。
- 改造 `weatherAgent`（包括让它获得看图能力）或任何天气链路行为变化。
- 项目类型创建后修改的 UI 或迁移逻辑。
- 跨浏览器、跨设备或账号级同步；服务端附件存储；IndexedDB 图片持久化。
- 前端图片压缩或缩放（凭后续实际体验再决策）。
- 通用助手的工具能力（联网搜索等），本轮定位纯对话。
- 多标签页冲突合并、会话级 agent 切换、批量会话管理。

## Further Notes

- 实现涉及 Mastra 改动，开始前必须先加载 `mastra` skill（项目 AGENTS.md 硬性规则）；远端不可用时核对 node_modules 类型定义。
- 前端新增样式变量一律使用 `--wc-*` 前缀；组件接线遵循视觉契约 ticket 的既有约定（浅色主题、洋红强调色、错误态文案颜色）。
- 实现完成后需同步更新：项目 AGENTS.md 的运行时架构与代码结构说明、领域词汇表的新术语、本地图（map）的决策记录。
- Moonshot 图片限制：仅 base64 内联或文件引用，不收 URL 图片；单请求体上限 100M，建议图片不超 4K。历史图片消息在多轮中会重复上行，本轮接受该开销。
- 大图体验（原图直发何时明显变慢）和占位符的最终渲染样式留作后续调优，不阻塞本规格。
