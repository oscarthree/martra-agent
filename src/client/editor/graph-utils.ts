import type { Edge, Node, Connection } from "@xyflow/react";
import {
  workflowNodeSchema,
  type ConditionBranch,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeType,
} from "../../shared/workflow-dsl";

// 编辑器图逻辑（纯函数，可单测）：xyflow 受控状态与 DSL 存储格式互转、
// 连线即时约束、节点摘要。存储格式 = DSL 格式 = toObject() 形状（见票 01）。

export type EditorNode = Node<WorkflowNode["data"]>;
export type EditorEdge = Edge;

export const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  start: "开始",
  llm: "LLM",
  tool: "工具",
  condition: "条件",
  end: "结束",
};

export function createNodeId(): string {
  return crypto.randomUUID();
}

export function createBranchId(): string {
  return crypto.randomUUID();
}

export function defaultNodeData(type: WorkflowNodeType, toolNames: string[]): WorkflowNode["data"] {
  switch (type) {
    case "start":
      return {};
    case "llm":
      return { prompt: "" };
    case "tool":
      return { toolName: toolNames[0] ?? "", args: {} };
    case "condition":
      return {
        branches: [
          { id: createBranchId(), expression: { left: "", op: "equals", right: "" } },
          { id: createBranchId() },
        ],
      };
    case "end":
      return { output: "" };
  }
}

export function createEditorNode(
  type: WorkflowNodeType,
  position: { x: number; y: number },
  toolNames: string[],
): EditorNode {
  return {
    id: createNodeId(),
    type,
    position,
    data: defaultNodeData(type, toolNames),
  };
}

// 序列化：剔除 xyflow 运行时字段（measured/selected/dragging 等），
// 只留存储格式四元组；边缺省 sourceHandle 字段直接省略。
export function serializeGraph(
  nodes: EditorNode[],
  edges: EditorEdge[],
  viewport: WorkflowGraph["viewport"],
): WorkflowGraph {
  return {
    version: 1,
    viewport,
    nodes: nodes.map((node) => {
      if (!isNodeType(node.type)) {
        throw new Error(`未知节点类型: ${String(node.type)}`);
      }
      // 经 schema 重建拿到判别联合的正确收窄（顺带规范化 data）
      return workflowNodeSchema.parse({
        id: node.id,
        type: node.type,
        position: { x: node.position.x, y: node.position.y },
        data: node.data,
      });
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(typeof edge.sourceHandle === "string" && edge.sourceHandle !== ""
        ? { sourceHandle: edge.sourceHandle }
        : {}),
    })),
  };
}

export function isNodeType(value: unknown): value is WorkflowNodeType {
  return value === "start" || value === "llm" || value === "tool" || value === "condition" || value === "end";
}

// 恢复：DSL 图 → 编辑器状态（画布运行时字段由 xyflow 自行补）
export function deserializeGraph(graph: WorkflowGraph): {
  nodes: EditorNode[];
  edges: EditorEdge[];
} {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { ...node.position },
      data: node.data,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
    })),
  };
}

// 连线即时约束（环 / 可达性 / 插值悬空留给保存时校验，见规格 §5.4）：
// start 无入边、end 无出边、禁自连、禁同节点对重复边（condition 按分支 handle 判重）、
// condition 出边必须经已声明的分支 handle，非 condition 节点出边不带 handle。
export function isValidConnection(nodes: EditorNode[], edges: EditorEdge[], connection: Connection): boolean {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;
  if (source.id === target.id) return false;
  if (target.type === "start") return false;
  if (source.type === "end") return false;

  const handle = typeof connection.sourceHandle === "string" ? connection.sourceHandle : undefined;
  if (source.type === "condition") {
    if (!handle) return false;
    const branches = (source.data as { branches: ConditionBranch[] }).branches;
    if (!branches.some((branch) => branch.id === handle)) return false;
  } else if (handle) {
    return false;
  }

  const duplicate = edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? undefined) === handle,
  );
  return !duplicate;
}

// 画布节点上的摘要文本（节点不内嵌表单，见规格 §5.4）
export function nodeSummary(node: Pick<EditorNode, "type" | "data">): string {
  switch (node.type) {
    case "start":
      return "接收用户消息";
    case "llm": {
      const prompt = (node.data as { prompt: string }).prompt;
      return clip(prompt || "未设置提示词");
    }
    case "tool": {
      const toolName = (node.data as { toolName: string }).toolName;
      return toolName || "未选择工具";
    }
    case "condition": {
      const branches = (node.data as { branches: ConditionBranch[] }).branches;
      return `${branches.length} 个分支`;
    }
    case "end": {
      const output = (node.data as { output: string }).output;
      return clip(output || "未设置输出");
    }
    default:
      return "";
  }
}

function clip(text: string, max = 24): string {
  return [...text].slice(0, max).join("");
}
