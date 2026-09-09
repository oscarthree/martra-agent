# 设计自定义 Agent 前端 UX 与编辑器

- Type: `wayfinder:grilling`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Assignee: kimi
- Blocking: 编写自定义 Agent 工作流编排实现规格

## Question

前端形态定型：侧栏"自定义 Agent"管理区（列表/新建/重命名/删除）的交互；全屏编辑器页面结构（节点面板、画布、节点属性编辑区、保存/校验反馈）；新建项目弹窗中 custom 类型的 Agent 选择器；编辑中离开页面的未保存保护。前置依赖「调研 @xyflow/react 与 React 19 前端集成要点」的结论。

## Resolution

草案经逐条确认（Q1–Q8 全部按推荐）：

- **导航**：不引入路由库。编辑器是工作区内的视图切换（聊天视图 ↔ Agent 管理/编辑器视图），侧栏新增"自定义 Agent"入口；视图状态进工作区 UI state，刷新回聊天视图。
- **侧栏管理区**：列出自定义 Agent 定义（名称 + 更新时间），操作含编辑/重命名/删除；被项目引用的定义删除禁用并提示引用数；新建只填名称，自动带 `start → llm → end` 默认模板图（开箱可跑，顺带演示插值）。
- **编辑器布局**：三栏——左侧节点面板（四种节点卡片，点击或拖拽添加）、中间 xyflow 画布（节点只显示类型图标 + 名称/摘要，不内嵌表单）、右侧属性面板（选中节点时编辑其 data 字段）。依据 [调研 @xyflow/react 与 React 19 前端集成要点](research-xyflow-react-flow-integration.md)：受控状态模型 + `updateNodeData`；`nodeTypes` 组件外定义；固定 `colorMode="light"`；样式前缀与 `--wc-*` 零冲突。
- **保存与校验**：显式保存按钮，前端先跑完整校验；失败时画布顶部错误条列出全部问题 + 问题节点红色高亮，全部通过才调保存 API；不做自动保存（画布中间态几乎总是"非法"，与严格校验冲突）。
- **未保存保护**：dirty 时切换视图或关闭页面弹确认（`beforeunload` + 视图切换拦截）。
- **连线规则**：`isValidConnection` 即时约束——start 无入边、end 无出边、禁止自连、禁止同节点对重复边、condition 出边必须从分支 handle 引出；环检测/可达性/插值悬空等语义校验统一在保存时。
- **新建项目弹窗**：选"自定义助手"类型时出现 Agent 定义下拉（按名称排序）；无定义时显示空态文案 + "去创建"跳转；创建后不可改沿用现有语义。
- **会话侧**：custom 项目会话的聊天界面与现有完全一致，v1 零新增 UI（无画布缩略、无节点进度）；Agent 名称仅体现在项目/会话展示位。
