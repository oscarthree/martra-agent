# 05 — 可视化画布编辑器

**What to build:** Dify 风格节点-连线可视化编辑器（规格 §5.4），基于 xyflow v12（正式支持 React 19）。三栏布局：左侧节点面板（start / llm / tool / condition / end 节点卡片，点击或拖拽添加）、中间画布（受控状态模型，节点只显示类型图标 + 名称/摘要，不内嵌表单）、右侧属性面板（选中节点时编辑其 data 字段）。显式保存、无自动保存：前端先跑 01 的共享校验，失败时画布顶部错误条列出全部问题 + 问题节点红色高亮，全部通过才调 PUT。未保存保护：dirty 时切换视图弹确认 + 页面关闭 beforeunload。连线即时约束（isValidConnection）：start 无入边、end 无出边、禁止自连、禁止同节点对重复边、condition 出边必须从分支 handle 引出；环 / 可达性 / 插值悬空统一留在保存时校验。序列化用 `toObject()` 剔除运行时字段后 PUT，恢复时还原画布与视口。固定浅色主题，xyflow 样式以 `.react-flow` 为作用域锚点覆写，新增自定义样式一律 `--wc-*` 前缀。

**Blocked by:** [03 — 侧栏自定义 Agent 管理区](03-agent-manager-sidebar.md)（入口与视图切换在其视图体系内）

**Status:** closed（2026-10-02）

**规格来源:** [wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md) §5.4、§7

- [x] 打开定义即见默认模板图（start → llm → end），四类业务节点可增删改、属性面板可编辑 data
- [x] 保存成功落库，重新打开图一致；校验失败时错误条列出全部问题、问题节点高亮、不发出 PUT
- [x] dirty 状态切换视图 / 关闭页面均有确认拦截
- [x] 连线约束即时生效（含 condition 分支 handle）
- [x] `pnpm test` 与 `pnpm exec tsc --noEmit` 全绿

**实施备注:**
- 新增 `agent-editor.tsx`（三栏：PaletteCard 节点面板 / ReactFlow 受控画布 / 属性面板按类型编辑）与 `editor/graph-utils.ts`（纯函数：序列化经 zod schema 重建拿判别联合收窄、连线五项即时约束、节点摘要），12 个用例。
- 保存以真实视口序列化；恢复还原画布+视口；初始装载走 setNodes 不经 onNodesChange 天然不脏。
- **为工具节点选项补了欠账**：`GET /api/custom-agents/tools` 只读端点（注册在 `/:id` 之前），service 依赖从 toolNames 升级为带描述的注册表条目；registry 拉取失败时编辑器常驻提示（否则合法图会因 unknown_tool 无法保存）。
- 管理区"编辑"启用、新建直达编辑器（`key={definitionId}` 重挂载隔离状态）；侧栏"自定义 Agent"入口在编辑器 dirty 时同样弹确认（dirty 经 onDirtyChange 上抛，补齐了规格视图切换拦截的另一半）。
- code review 修复：dimensions 变更误标 dirty、批量 select 变更取最后一条、移除 hideAttribution（xyflow 许可不允许无订阅隐藏）、nodeSummary 改 Pick 签名去 cast、PaletteCard 收 useCallback。
- 已知边界：内嵌条件分支再汇聚等图形状由编译期报错（票 06 备注），编辑器保存校验负责拒绝坏图。
