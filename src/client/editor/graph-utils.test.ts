import { describe, expect, it } from "vitest";
import type { ConditionBranch } from "../../shared/workflow-dsl";
import {
  createEditorNode,
  defaultNodeData,
  deserializeGraph,
  isValidConnection,
  nodeSummary,
  serializeGraph,
  type EditorEdge,
  type EditorNode,
} from "./graph-utils";

const TOOLS = ["get-weather", "web-open-url"];
const pos = { x: 0, y: 0 };

describe("defaultNodeData", () => {
  it("creates a two-branch condition with a trailing fallback", () => {
    const data = defaultNodeData("condition", TOOLS) as { branches: ConditionBranch[] };
    expect(data.branches).toHaveLength(2);
    expect(data.branches[0]?.expression).toBeDefined();
    expect(data.branches[1]?.expression).toBeUndefined();
  });

  it("defaults the tool node to the first registered tool", () => {
    expect(defaultNodeData("tool", TOOLS)).toEqual({ toolName: "get-weather", args: {} });
    expect(defaultNodeData("tool", [])).toEqual({ toolName: "", args: {} });
  });
});

describe("serializeGraph", () => {
  it("strips runtime-only fields from nodes and edges", () => {
    const nodes = [
      { ...createEditorNode("start", pos, TOOLS), selected: true, measured: { width: 1, height: 1 }, dragging: false },
    ] as EditorNode[];
    const edges = [
      { id: "x1", source: nodes[0]!.id, target: "n2", selected: true },
    ] as EditorEdge[];

    const graph = serializeGraph(nodes, edges, { x: 0, y: 0, zoom: 1 });

    expect(graph.version).toBe(1);
    expect(graph.nodes[0]).toEqual({
      id: nodes[0]!.id,
      type: "start",
      position: { x: 0, y: 0 },
      data: {},
    });
    expect(graph.edges[0]).toEqual({ id: "x1", source: nodes[0]!.id, target: "n2" });
  });

  it("keeps condition branch handles on edges", () => {
    const condition = createEditorNode("condition", pos, TOOLS);
    const branchId = (condition.data as { branches: ConditionBranch[] }).branches[0]!.id;
    const edges = [
      { id: "x1", source: condition.id, target: "n2", sourceHandle: branchId },
    ] as EditorEdge[];

    const graph = serializeGraph([condition], edges, { x: 0, y: 0, zoom: 1 });

    expect(graph.edges[0]?.sourceHandle).toBe(branchId);
  });

  it("round-trips through deserializeGraph", () => {
    const start = createEditorNode("start", pos, TOOLS);
    const end = createEditorNode("end", { x: 200, y: 0 }, TOOLS);
    (end.data as { output: string }).output = "回复：{{" + start.id + "}}";
    const edges = [{ id: "x1", source: start.id, target: end.id }] as EditorEdge[];
    const graph = serializeGraph([start, end], edges, { x: 1, y: 2, zoom: 3 });

    const restored = deserializeGraph(graph);

    expect(restored.nodes).toHaveLength(2);
    expect(restored.nodes[1]?.data).toEqual(end.data);
    expect(restored.edges).toEqual(edges);
  });
});

describe("isValidConnection", () => {
  const setup = () => {
    const start = createEditorNode("start", pos, TOOLS);
    const llm = createEditorNode("llm", pos, TOOLS);
    const cond = createEditorNode("condition", pos, TOOLS);
    const end = createEditorNode("end", pos, TOOLS);
    const branchId = (cond.data as { branches: ConditionBranch[] }).branches[0]!.id;
    return { nodes: [start, llm, cond, end], start, llm, cond, end, branchId };
  };

  it("allows a plain chain connection", () => {
    const { nodes, start, llm } = setup();
    expect(isValidConnection(nodes, [], { source: start.id, target: llm.id, sourceHandle: null, targetHandle: null })).toBe(true);
  });

  it("rejects self-loops and edges into start / out of end", () => {
    const { nodes, start, llm, end } = setup();
    expect(isValidConnection(nodes, [], { source: llm.id, target: llm.id, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(isValidConnection(nodes, [], { source: llm.id, target: start.id, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(isValidConnection(nodes, [], { source: end.id, target: llm.id, sourceHandle: null, targetHandle: null })).toBe(false);
  });

  it("rejects duplicate edges between the same pair", () => {
    const { nodes, start, llm } = setup();
    const edges = [{ id: "x1", source: start.id, target: llm.id }] as EditorEdge[];
    expect(isValidConnection(nodes, edges, { source: start.id, target: llm.id, sourceHandle: null, targetHandle: null })).toBe(false);
  });

  it("requires condition out-edges to use a declared branch handle", () => {
    const { nodes, cond, end, branchId } = setup();
    expect(isValidConnection(nodes, [], { source: cond.id, target: end.id, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(isValidConnection(nodes, [], { source: cond.id, target: end.id, sourceHandle: "ghost", targetHandle: null })).toBe(false);
    expect(isValidConnection(nodes, [], { source: cond.id, target: end.id, sourceHandle: branchId, targetHandle: null })).toBe(true);
  });

  it("rejects handles on non-condition sources and duplicate per-branch edges", () => {
    const { nodes, start, llm, cond, end, branchId } = setup();
    expect(isValidConnection(nodes, [], { source: llm.id, target: end.id, sourceHandle: "h", targetHandle: null })).toBe(false);
    const edges = [{ id: "x1", source: cond.id, target: end.id, sourceHandle: branchId }] as EditorEdge[];
    expect(isValidConnection(nodes, edges, { source: cond.id, target: end.id, sourceHandle: branchId, targetHandle: null })).toBe(false);
    // 同一节点对不同 handle 的两条边不冲突
    const otherBranch = (cond.data as { branches: ConditionBranch[] }).branches[1]!.id;
    expect(isValidConnection(nodes, edges, { source: cond.id, target: end.id, sourceHandle: otherBranch, targetHandle: null })).toBe(true);
  });

  it("rejects connections to unknown nodes", () => {
    const { nodes, start } = setup();
    expect(isValidConnection(nodes, [], { source: start.id, target: "ghost", sourceHandle: null, targetHandle: null })).toBe(false);
  });
});

describe("nodeSummary", () => {
  it("summarizes each node type for the canvas", () => {
    const llm = createEditorNode("llm", pos, TOOLS);
    (llm.data as { prompt: string }).prompt = "总结这段文字的内容要点";
    expect(nodeSummary(llm)).toBe("总结这段文字的内容要点");

    const tool = createEditorNode("tool", pos, TOOLS);
    expect(nodeSummary(tool)).toBe("get-weather");

    const cond = createEditorNode("condition", pos, TOOLS);
    expect(nodeSummary(cond)).toBe("2 个分支");

    const end = createEditorNode("end", pos, TOOLS);
    expect(nodeSummary(end)).toBe("未设置输出");

    expect(nodeSummary(createEditorNode("start", pos, TOOLS))).toBe("接收用户消息");
  });
});
