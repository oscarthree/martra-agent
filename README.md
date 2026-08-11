# Weather Copilot

一个基于 Express、Mastra、AG-UI 和 CopilotKit 的天气助手示例。用户可以查询指定城市的当前天气，也可以根据未来 1 到 7 天的天气预报生成活动和旅行计划。

项目使用 Moonshot 的 OpenAI 兼容接口提供模型能力，前端保留 CopilotKit Chat 交互界面，后端通过 Mastra 管理 Agent、Tool、Workflow、Memory 和存储。

## 功能

- 查询城市当前天气，包括温度、体感温度、湿度、风速、阵风和天气状况
- 根据天气规划活动、旅行或多日行程
- 支持 1 到 7 天的天气预报和活动安排
- 根据用户请求自动选择当前天气工具或活动规划工作流
- 使用活动规划模板输出每日天气概况、户外活动、室内备选活动和注意事项
- 通过 Mastra Memory 保存对话上下文
- 浏览器使用持久化 resource ID，使同一用户的会话能够关联到对应资源
- 通过 AG-UI 和 CopilotKit 保持流式聊天体验

## 技术架构

```text
CopilotChat
	|
	| /api/copilotkit
	v
CopilotKit Runtime v2
	|
	v
AG-UI Mastra Adapter
	|
	v
weatherAgent
	|-- 普通当前天气查询 -> weatherTool -> Open-Meteo
	|
	`-- 活动/行程请求 -> weatherWorkflow
							|-- 地理编码和多日天气预报 -> Open-Meteo
							`-- activityPlannerAgent -> 模板化活动规划
```

意图识别由 `weatherAgent` 根据指令和可用能力进行工具选择：

- 普通当前天气查询使用 `weatherTool`
- 活动、行程、旅游、出游、攻略或计划请求使用 `weatherWorkflow`

## 环境要求

- Node.js 24 或更高版本
- pnpm 10 或更高版本
- Moonshot API Key

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，并填写 Moonshot API Key：

```bash
cp .env.example .env
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

`.env` 示例：

```env
PORT=3000
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MOONSHOT_API_KEY=your-moonshot-api-key
```

`MOONSHOT_BASE_URL` 未设置时默认使用 `https://api.moonshot.cn/v1`。API Key 必须配置，否则模型请求无法正常执行。

### 3. 启动后端

在一个终端运行：

```bash
pnpm start
```

后端默认监听 `http://localhost:3000`，CopilotKit 接口地址为：

```text
http://localhost:3000/api/copilotkit
```

### 4. 启动前端

在另一个终端运行：

```bash
pnpm client:dev
```

Vite 默认使用 `http://localhost:5173`。如果端口已被占用，Vite 会自动选择下一个可用端口。前端开发服务器会把 `/api` 请求代理到后端的 `http://localhost:3000`。

## 使用示例

普通天气查询：

```text
北京现在的天气怎么样？
```

多日活动规划：

```text
帮我安排大连三天行程
```

工作流输入格式如下：

```ts
{
  city: string;
  days: number; // 1 到 7，默认为 1
}
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装项目依赖 |
| `pnpm start` | 启动 Express、Mastra 和 CopilotKit 后端 |
| `pnpm client:dev` | 启动 Vite 前端开发服务器 |
| `pnpm client:build` | 构建前端生产版本 |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm exec tsc --noEmit` | 执行 TypeScript 类型检查 |

## 目录结构

```text
src/
├── index.ts                         # Express 服务和 CopilotKit Runtime
├── client/
│   ├── main.tsx                     # CopilotKit Chat 入口
│   └── styles.css                   # 前端样式
└── mastra/
	├── index.ts                     # Mastra 实例和组件注册
	├── agents/
	│   ├── weather-agent.ts         # 天气主 Agent 和意图路由
	│   └── activity-planner-agent.ts   # 活动规划 Agent
	├── tools/
	│   └── weather-tool.ts          # 当前天气工具
	└── workflows/
		├── weather-workflow.ts      # 多日天气和活动规划工作流
		└── weather-workflow.test.ts # 工作流输入校验测试
```

## 数据和存储

开发环境下，Mastra 使用本地 LibSQL 文件保存应用数据，并使用 DuckDB 保存可观测性数据。运行服务后可能会生成以下本地文件：

- `mastra.db`
- `mastra.db-shm`
- `mastra.db-wal`
- `mastra.duckdb`
- `mastra.duckdb.wal`

这些文件属于运行时数据，不应提交到版本库。

## 外部服务

- [Moonshot API](https://platform.moonshot.cn/)：提供 Kimi 模型能力
- [Open-Meteo Geocoding API](https://geocoding-api.open-meteo.com/)：将城市名称转换为坐标
- [Open-Meteo Forecast API](https://open-meteo.com/)：提供当前天气和多日天气预报
- [Mastra](https://mastra.ai/)：Agent、Workflow、Memory 和存储能力
- [CopilotKit](https://www.copilotkit.ai/)：前端聊天界面和运行时协议

## 注意事项

- 天气数据来自外部 API，实际结果会受网络和 API 可用性影响。
- 活动建议由模型根据天气数据生成，仅供参考，不应替代专业天气预警或旅行安全建议。
- 当前模型固定使用 `kimi-k2.7-code`，通过 `MOONSHOT_BASE_URL` 和 `MOONSHOT_API_KEY` 连接 Moonshot 服务。
