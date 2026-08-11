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
app.use(express.json());

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
