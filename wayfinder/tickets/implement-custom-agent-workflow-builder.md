# 编写自定义 Agent 工作流编排实现规格

- Type: `wayfinder:grilling`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Assignee: kimi
- Blocking: —

## Question

汇总本图全部已收敛决策，产出 ready-for-agent 实现规格：图 DSL 与校验、数据模型与 REST API、前端编辑器与管理区、项目绑定与会话路由、编译执行链路、测试策略与验收标准。被本图其余全部 ticket 阻塞。

## Resolution

规格已产出：**[wayfinder/specs/custom-agent-workflow-builder.md](../specs/custom-agent-workflow-builder.md)**。

汇总了全部 8 张已关闭决策票的结论，覆盖票要求的六个断面：图 DSL 与校验（`src/shared/workflow-dsl.ts` 双端复用）、数据模型与 REST API（`custom_agent_definitions` 表 + 五端点）、前端编辑器与管理区（xyflow 三栏、显式保存、删除保护在前端）、项目绑定与会话路由（`custom-<definitionId>`、错误态不降级）、编译执行链路（WorkflowAgent a 方案 + 原型实测的合成流形状）、测试策略与七条验收标准。另含文件改动清单与明确的非目标。

**地图走完**：9 张票全部关闭，Destination 达成。按 ask-matt 主流程交接——本规格即 /to-spec 的产出，下一步直接 `/to-tickets` 拆实现票（各自声明 blocking 边），然后逐票 `/implement`。
