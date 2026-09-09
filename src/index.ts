import 'dotenv/config';
import express, { type Request, type Response } from "express";
import { MastraServer } from "@mastra/express";
import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
import { mastra } from "./mastra";

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
  agents: ({ request }) =>
    MastraAgent.getLocalAgents({
      mastra,
      resourceId: request.headers.get("x-mastra-resource-id") || "default",
    }),
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

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
