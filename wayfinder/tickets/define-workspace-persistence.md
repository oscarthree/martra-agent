# 定义浏览器工作区持久化模型

- Type: `wayfinder:grilling`
- Parent map: [Kimi 风格天气工作区](../maps/kimi-style-weather-workspace.md)
- Status: closed
- Blocking: 前端状态实现与数据迁移

## Question

确定项目、会话、消息快照、当前项目和当前会话在 `localStorage` 中的结构、默认数据、删除/重命名规则、损坏数据恢复策略，以及已有 `mastra-resource-id` 与新工作区数据之间的关系。

## Resolution

采用单一、版本化的浏览器工作区状态：

```ts
type WorkspaceState = {
	version: 1;
	projects: Project[];
	sessions: Session[];
	activeProjectId: string;
	activeSessionId: string;
};

type Project = {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
};

type Session = {
	id: string;
	projectId: string | null;
	title: string;
	messages: Message[];
	createdAt: string;
	updatedAt: string;
};
```

存储 key 固定为 `weather-copilot-workspace-v1`。首次打开时创建一个名为“天气助手”的默认项目和一个空会话；空会话标题为“新会话”。第一条用户消息产生后，标题取去除换行后的前 24 个字符，用户仍可手动重命名。

会话保存完整的 AG-UI 消息对象，而不是只保存文本。工作区状态在消息变化后保存，并对写入做轻量节流。项目、会话、消息快照、当前项目和当前会话全部保存在同一个工作区对象中。

`mastra-resource-id` 保持独立：它继续作为后端 Mastra Memory 的资源标识；前端 `projectId` 和 `sessionId` 只负责工作区分组与快照恢复，不替换或派生 resource ID。

如果数据解析失败、schema 不符合预期或 localStorage 写入失败：保留当前内存状态，清理损坏数据并重建默认工作区；界面显示一次轻量错误提示。当前只支持版本 1，不实现复杂迁移。多标签页只监听 `storage` 事件刷新状态，不实现冲突合并。暂不引入 IndexedDB，超大快照的处理限制在错误提示和保留内存状态。
