import 'dotenv/config';
import express, { type Request, type Response } from "express";
import { MastraServer } from "@mastra/express";
import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
import { mastra, customAgents, customAgentRegistry } from "./mastra";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// CopilotKit 每轮把完整消息历史（含 base64 图片、网页抓取的大段 HTML 工具结果）
// 放进请求体，默认 100KB 限制会 413。历史中的大 HTML 另由 ToolResultTrimmer 在
// 送入模型前压缩（见 processors/tool-result-trimmer.ts）。
app.use(express.json({ limit: "20mb" }));

const server = new MastraServer({ app, mastra });
await server.init();

const copilotRuntime = new CopilotRuntime({
  agents: async ({ request }) => {
    const resourceId = request.headers.get("x-mastra-resource-id") || "default";
    // 动态注册的自定义 Agent 在本请求枚举前 ensure，注册后即能按 custom-<id> 路由
    await customAgentRegistry.ensureAgentsForResource(resourceId);
    return MastraAgent.getLocalAgents({ mastra, resourceId });
  },
});

app.use(
  createCopilotExpressHandler({
    runtime: copilotRuntime,
    basePath: "/api/copilotkit",
    mode: "single-route",
  }),
);

// Routes
app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Hello, World!" });
});

app.use("/api/custom-agents", customAgents.router);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
