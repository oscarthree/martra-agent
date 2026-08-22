# 05 — 完成错误处理、可访问性和最终验收

**What to build:** 工作区在真实流式聊天、发送失败、存储异常、键盘操作和移动端使用下能够稳定恢复。错误以内联方式展示并支持重试，不破坏已有 Message Snapshot；完整功能通过工程、视觉和可访问性验收。

**Blocked by:** 04 — 交付 Kimi 风格响应式天气工作区

**Status:** completed

- [x] 空名称或重复项目名称在输入框下显示错误，弹窗保持打开且布局不跳动
- [x] 发送失败以内联消息显示，并提供明确的重试或关闭操作
- [x] 存储失败使用轻量提示，不改变侧栏宽度并保留当前内存状态
- [x] 空状态和错误状态都保留输入区
- [x] 焦点环可见且使用洋红色，不改变控件尺寸
- [x] 项目选择器、菜单、对话框和移动端抽屉支持键盘操作
- [x] 抽屉打开时焦点限制在抽屉内，关闭后返回菜单按钮
- [x] 错误、成功和选中态不只依赖颜色表达，并满足文字对比度要求
- [x] reduced-motion 偏好关闭非必要动画
- [x] 桌面和移动截图确认侧栏、顶部栏、聊天区、输入区、菜单和弹窗无重叠
- [x] 通过 `pnpm test`
- [x] 通过 `pnpm exec tsc --noEmit`
- [x] 通过 `pnpm client:build`
- [x] 在环境变量和服务可用时完成真实 `/api/copilotkit` 流式聊天验收

验收方式：`.scratch/visual-check/accept.cjs`（playwright-core + 本机 Edge headless），15 项断言全部通过——弹窗校验与布局稳定、菜单键盘操作、发送失败注入与内联重试/关闭、抽屉焦点囚禁与焦点返回、reduced-motion、真实流式聊天（Moonshot 模型实际回复）、刷新后 Message Snapshot 恢复。

关键修复：

- `copilotkit.runAgent` 失败时**不会 reject**，错误只经事件上报；provider 级 `onError` 在该版本也不会触发。改为在 `useAgent` 返回的 agent 上 `agent.subscribe({ onRunFailed })` 捕获失败，驱动内联错误条。
- `.field-error` 固定 24px 高度（6px padding + 18px 行高），消除错误出现时的 3px 布局跳动；错误文本带 `title` 兜底。
- 移除无效的 `className="chat-view"`（CopilotChatView 使用 render-prop children 时不渲染该 className）及对应失效 CSS。
