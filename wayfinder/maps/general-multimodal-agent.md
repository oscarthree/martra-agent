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
- [定义项目 Agent 类型绑定与工作区状态扩展](../tickets/define-project-agent-type-binding.md) — Project 与 Session 均带 `agentType`（Session 创建时捕获）；存储 key 不变、v1 原地迁移到 v2；新建项目弹窗选类型且创建后不可改；`runtimeAgentId` 按会话类型推导。
- [验证受控附件接线与图片全链路](../tickets/verify-controlled-attachment-pipeline.md) — 不再单独做原型；实时全链路发图问答转为实现规格的验收门槛，占位符结构在规格中统一定义。
- [编写通用助手实现规格](../tickets/implement-general-assistant.md) — `ready-for-agent` 实现规格，覆盖 generalAgent 定义与注册、类型绑定与 v1→v2 迁移、受控附件接线、快照占位符降级、按类型区分的空状态和验收标准。

## Implementation tickets

- [01 — 后端并列注册通用助手 agent](../../.scratch/general-multimodal-agent/issues/01-general-agent-backend.md) — done。
- [02 — 工作区状态 v2：项目/会话类型与原地迁移](../../.scratch/general-multimodal-agent/issues/02-workspace-state-v2-agent-type.md) — done。
- [03 — 项目类型选择与会话 agent 路由](../../.scratch/general-multimodal-agent/issues/03-project-type-selection-and-agent-routing.md) — done。
- [04 — 通用会话的图片附件与快照占位降级](../../.scratch/general-multimodal-agent/issues/04-image-attachments-and-snapshot-placeholder.md) — done。
- [05 — 端到端验收与文档同步](../../.scratch/general-multimodal-agent/issues/05-e2e-acceptance-and-docs.md) — done。

## 实现阶段补充决策

- 占位符渲染：图片快照占位以内联纯文本"[图片未保存到本地]"呈现，不做自定义消息渲染器（成本与价值不成比例）。
- 发现并已修复：净化快照与 agent 实时消息永远不相等会导致保存-渲染死循环；`reconcileSessionMessages` 比较前对 agent 侧做同样净化（有回归测试）。
- 附件只接受图片（`image/*`），上传中点击发送静默拦截（文本与附件保留，可重发）。
- 全链路验收已在浏览器实测通过：模型正确描述测试图片内容；v1 数据原地迁移、多轮追问、刷新占位、天气会话回归全部通过。

## Not yet specified

- 大图体验：原图直发在多大尺寸下开始明显变慢，何时引入前端压缩。
- 视频输入（模型侧已支持，本轮不铺开）。

## 后续决策

- 通用助手联网能力（2026-08-25 grilling 收敛）：最初采用 coding 端点的 `$web_search` 内置工具 + echo 回传，详见 [ADR 0001](../../docs/adr/0001-web-search-builtin-on-coding-endpoint.md)。多轮实测跑不通后放弃，改为自建 `web_open_url` 抓取工具（ADR 0002），并为豆瓣类反爬挑战站点补充无头浏览器 `web_open_url_rendered`（ADR 0003）。助手无主动搜索能力，只能打开用户给出的具体 URL。

## Out of scope

- 图片生成、语音输入输出、文档解析等图片理解之外的多模态方向。
- 改造 `weatherAgent`（包括让它获得看图能力）。
- 跨浏览器、跨设备或账号级同步；服务端附件存储。
