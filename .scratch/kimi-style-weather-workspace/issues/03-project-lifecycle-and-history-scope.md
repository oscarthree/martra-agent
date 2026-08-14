# 03 — 实现项目生命周期和历史范围

**What to build:** 用户可以创建、选择、重命名和删除 Project；Project Context Selector 与侧栏反映 Active Project，项目视图筛选 Session History，但切换项目不会移动或自动切换当前会话。删除项目后会话进入 Unclassified Session，全部历史仍可跨项目查看。

**Blocked by:** 01 — 建立浏览器工作区状态边界

**Status:** ready-for-agent

- [ ] 创建项目后立即选中新项目，并创建一个空会话
- [ ] Project Context Selector 能显示当前项目、其他项目、未分类和新建项目入口
- [ ] 选择项目后更新 Active Project 和默认历史筛选范围
- [ ] 切换 Active Project 不移动 Active Session，也不自动打开另一段会话
- [ ] 项目视图只显示当前项目会话，全部历史视图支持跨项目查看
- [ ] 项目可重命名，名称变化同步反映在顶部选择器和项目列表
- [ ] 删除项目需要确认，并将其会话移为 Unclassified Session 而不是删除
- [ ] 未分类会话不会因活动项目变化而自动归属项目
- [ ] 删除当前项目后选择剩余项目中的第一个；没有项目时重建“天气助手”默认项目
- [ ] 空项目显示欢迎内容和推荐问题，不创建示例历史
- [ ] 项目生命周期、筛选和未分类行为测试覆盖上述外部行为
