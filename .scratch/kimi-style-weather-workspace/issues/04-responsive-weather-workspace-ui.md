# 04 — 交付 Kimi 风格响应式天气工作区

**What to build:** 用户可以通过完整的桌面侧栏和移动端抽屉使用项目与会话工作区。界面采用 A+C 组合：约 240px 侧栏、顶部 Project Context Selector、项目优先分区、浅色主题和 Weather Copilot 洋红色交互色。

**Blocked by:** 02 — 实现会话创建、切换和快照恢复; 03 — 实现项目生命周期和历史范围

**Status:** completed

- [x] 桌面端侧栏依次呈现品牌、新建会话、工作区导航、项目、最近会话和本地工作区状态
- [x] 桌面端侧栏约 240px，顶部栏约 64px，聊天内容保持可读的最大宽度
- [x] Project Context Selector、项目列表和 Session History 连接真实 Workspace 状态
- [x] 新建会话、新建项目、重命名和删除操作从工作区 UI 可达
- [x] 新建项目与删除操作使用可关闭的确认或编辑对话框
- [x] 使用 Weather Copilot 自有品牌，不复制 Kimi Logo、名称、专属资产或文案
- [x] 使用浅色主题和 `#C43D86` 洋红色交互色，天气状态颜色与交互色可区分
- [x] `720px` 以下隐藏桌面侧栏并通过约 `min(280px, 86vw)` 的移动端抽屉提供相同导航
- [x] 抽屉支持遮罩关闭、导航后关闭和关闭后焦点返回菜单按钮
- [x] 空状态、历史状态、项目筛选和聊天消息不会发生布局重叠
- [x] 图标按钮使用 lucide-react，并具有可访问名称和悬停提示
- [x] 初始内容、抽屉、菜单和对话框使用克制的功能性动效，并尊重 reduced-motion
- [x] 桌面和移动浏览器验收覆盖主要导航和布局路径

实现说明：

- 验收通过 headless Edge 截图完成（桌面 / 菜单 / 弹窗 / 移动端 / 抽屉），脚本在 `.scratch/visual-check/shoot.cjs`（playwright-core + 本机 Edge，不下载浏览器）。
- 自定义 CSS 变量统一使用 `--wc-*` 前缀：CopilotKit 的 `[data-copilotkit]` 主题会重定义 `--accent`/`--muted` 等同名变量，曾导致欢迎文案被洗白。
- `enableInspector={false}` 关闭了 CopilotKit 开发检查器：它的悬浮层会拦截应用 UI 的指针事件。
- 抽屉和弹窗共享 `useFocusTrap`（Escape 关闭 + Tab 囚禁）；从抽屉打开弹窗时先关抽屉，避免两个陷阱冲突；关闭抽屉后焦点返回菜单按钮。
- 触屏设备（`hover: none`）下会话的改名/删除按钮常显。
- 新建项目弹窗用 `validateProjectName` 校验空名/重名，错误提示预留固定空间。
- 原生 prompt/confirm 已全部替换为应用内对话框。
