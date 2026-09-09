/**
 * 一次性原型：验证 WorkflowAgent（Agent 子类覆写 stream()、返回手工合成 fullStream）
 * 能否被 @ag-ui/mastra 的 MastraAgent 正常驱动。
 *
 * 对应票：wayfinder/tickets/prototype-workflow-agent-ag-ui-compat.md
 * 运行：pnpm exec tsx .scratch/prototype-workflow-agent.ts
 * 验证：
 *   curl -N -X POST http://localhost:3010/api/copilotkit \
 *     -H 'Content-Type: application/json' \
 *     -d '{"method":"agent/run","params":{"agentId":"protoEcho"},"body":{"threadId":"t-1","runId":"r-1","messages":[{"id":"m-1","role":"user","content":"测试"}],"tools":[],"context":[]}}'
 * 预期 SSE：RUN_STARTED → TEXT_MESSAGE_CHUNK × N → RUN_FINISHED
 *
 * 注意：不 import src/mastra（避免打开 mastra.db / mastra.duckdb 与用户 dev server 抢文件锁）。
 */
import express from "express";
import { Mastra } from "@mastra/core/mastra";
import { Agent } from "@mastra/core/agent";
import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";

const REPLY = "原型验证：WorkflowAgent 合成流正常，未调用任何模型。";

class WorkflowAgentProto extends Agent {
  override async stream(messages: unknown, options?: Record<string, unknown>) {
    const runId = (options as { runId?: string } | undefined)?.runId ?? "run-proto";
    const fullStream = new ReadableStream({
      start(controller) {
        // @ag-ui/mastra 只读 payload；TS 层补上 runId/from 凑形状
        const parts = ["原型验证：", "WorkflowAgent 合成流正常，", "未调用任何模型。"];
        parts.forEach((text, i) => {
          controller.enqueue({
            type: "text-delta",
            runId,
            from: "AGENT",
            payload: { id: `msg-proto`, text },
          });
          void i;
        });
        controller.enqueue({ type: "finish", runId, from: "AGENT", payload: {} });
        controller.close();
      },
    });
    return { fullStream, traceId: "trace-proto" } as never;
  }
}

const mastra = new Mastra({});
const proto = new WorkflowAgentProto({
  id: "workflow-agent-proto",
  name: "Workflow Agent Proto",
  instructions: "",
  model: {} as never, // 构造器只 truthy 检查；stream 被覆写后模型不会被触达
});
// 注册键取自 env：协议层验证用 protoEcho；浏览器层验证用 generalAgent
//（前端按会话 agentType 路由 runtimeAgentId，只有 weather/general 两个键可达）
const AGENT_KEY = process.env.PROTO_AGENT_KEY ?? "protoEcho";
mastra.addAgent(proto, AGENT_KEY);

const app = express();
app.use(express.json({ limit: "20mb" }));

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

const PORT = Number(process.env.PORT ?? 3010);
app.listen(PORT, () => {
  console.log(`prototype server on http://localhost:${PORT}, agent key: ${AGENT_KEY}, reply text: ${REPLY}`);
});
