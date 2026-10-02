import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, CirclePlay, CircleStop, Bot, Wrench, GitFork, Save } from "lucide-react";
import { getCustomAgent, getToolRegistry, updateCustomAgent } from "./custom-agent-api";
import {
  validateWorkflowGraph,
  conditionOperatorSchema,
  type ConditionBranch,
  type ConditionExpression,
  type ConditionOperator,
  type GraphValidationError,
  type WorkflowNodeType,
} from "../shared/workflow-dsl";
import {
  NODE_TYPE_LABELS,
  createBranchId,
  createEditorNode,
  createNodeId,
  deserializeGraph,
  isValidConnection,
  nodeSummary,
  serializeGraph,
  type EditorEdge,
  type EditorNode,
} from "./editor/graph-utils";

// Dify 风格三栏画布编辑器（规格 §5.4）：左节点面板 / 中画布（受控状态，
// 节点只显示图标+摘要，不内嵌表单）/ 右属性面板。显式保存、无自动保存。
// 选中/校验高亮由 xyflow 外层 wrapper 的 className 承载（.selected / .wc-node-invalid）。

const OPERATORS: readonly ConditionOperator[] = conditionOperatorSchema.options;

type CanvasNodeProps = NodeProps<EditorNode>;

function NodeFrame({
  icon,
  title,
  summary,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="wc-node">
      <Handle type="target" position={Position.Top} className="wc-handle" />
      <div className="wc-node-head">
        <span className="wc-node-icon" aria-hidden>{icon}</span>
        <span className="wc-node-title">{title}</span>
      </div>
      <div className="wc-node-summary">{summary}</div>
      {children}
      <Handle type="source" position={Position.Bottom} className="wc-handle" />
    </div>
  );
}

const StartNode = memo(function StartNode(_props: CanvasNodeProps) {
  return (
    <div className="wc-node">
      <div className="wc-node-head">
        <span className="wc-node-icon" aria-hidden><CirclePlay size={14} /></span>
        <span className="wc-node-title">开始</span>
      </div>
      <div className="wc-node-summary">接收用户消息</div>
      <Handle type="source" position={Position.Bottom} className="wc-handle" />
    </div>
  );
});

const LlmNode = memo(function LlmNode({ data }: CanvasNodeProps) {
  return <NodeFrame icon={<Bot size={14} />} title="LLM" summary={nodeSummary({ type: "llm", data })} />;
});

const ToolNode = memo(function ToolNode({ data }: CanvasNodeProps) {
  return <NodeFrame icon={<Wrench size={14} />} title="工具" summary={nodeSummary({ type: "tool", data })} />;
});

const EndNode = memo(function EndNode({ data }: CanvasNodeProps) {
  return <NodeFrame icon={<CircleStop size={14} />} title="结束" summary={nodeSummary({ type: "end", data })} />;
});

// 条件节点：每个分支一个 source handle（id = branch.id），兜底分支单独标注
const ConditionNode = memo(function ConditionNode({ data }: CanvasNodeProps) {
  const branches = (data as { branches: ConditionBranch[] }).branches;
  return (
    <div className="wc-node wc-node-condition">
      <Handle type="target" position={Position.Top} className="wc-handle" />
      <div className="wc-node-head">
        <span className="wc-node-icon" aria-hidden><GitFork size={14} /></span>
        <span className="wc-node-title">条件</span>
      </div>
      <div className="wc-node-branches">
        {branches.map((branch, index) => (
          <div key={branch.id} className="wc-branch-row">
            <span className="wc-branch-label">
              {branch.expression ? `分支 ${index + 1}` : "兜底分支"}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={branch.id}
              className="wc-handle wc-branch-handle"
            />
          </div>
        ))}
      </div>
      <div className="wc-node-summary">{nodeSummary({ type: "condition", data })}</div>
    </div>
  );
});

// nodeTypes 必须组件外定义（规格 §5.4）
const nodeTypes = {
  start: StartNode,
  llm: LlmNode,
  tool: ToolNode,
  condition: ConditionNode,
  end: EndNode,
};

const PALETTE: WorkflowNodeType[] = ["start", "llm", "tool", "condition", "end"];

// 节点面板卡片：点击或拖入画布添加（handler 全部 useCallback，规格 §5.4）
const PaletteCard = memo(function PaletteCard({
  type,
  onAdd,
}: {
  type: WorkflowNodeType;
  onAdd: (type: WorkflowNodeType) => void;
}) {
  const handleClick = useCallback(() => onAdd(type), [onAdd, type]);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter") onAdd(type);
    },
    [onAdd, type],
  );
  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.dataTransfer.setData("application/wc-node", type);
    },
    [type],
  );
  return (
    <div
      className="wc-palette-card"
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {NODE_TYPE_LABELS[type]}
      <span className="wc-palette-hint">点击或拖到画布</span>
    </div>
  );
});

function dropPosition(containerSelector: string, clientX: number, clientY: number) {
  const wrapper = document.querySelector(containerSelector);
  if (!wrapper) return { x: clientX, y: clientY };
  const bounds = wrapper.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

export function AgentEditorView({
  definitionId,
  onExit,
  onDirtyChange,
}: {
  definitionId: string;
  onExit: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  return (
    <ReactFlowProvider>
      <EditorCanvas definitionId={definitionId} onExit={onExit} onDirtyChange={onDirtyChange} />
    </ReactFlowProvider>
  );
}

function EditorCanvas({
  definitionId,
  onExit,
  onDirtyChange,
}: {
  definitionId: string;
  onExit: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>([]);
  const [name, setName] = useState("");
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [toolsError, setToolsError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<GraphValidationError[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { setViewport, getViewport } = useReactFlow();

  // 载入定义与工具注册表；初始装载不走 onNodesChange，不会标 dirty
  useEffect(() => {
    let cancelled = false;
    getCustomAgent(definitionId)
      .then((detail) => {
        if (cancelled) return;
        const graph = detail.graph as {
          nodes: never[];
          edges: never[];
          viewport?: { x: number; y: number; zoom: number };
        };
        const restored = deserializeGraph({
          version: 1,
          viewport: graph.viewport ?? { x: 0, y: 0, zoom: 1 },
          nodes: graph.nodes,
          edges: graph.edges,
        });
        setName(detail.name);
        setNodes(restored.nodes);
        setEdges(restored.edges);
        if (graph.viewport) void setViewport(graph.viewport);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "加载失败");
        }
      });
    getToolRegistry()
      .then((entries) => {
        if (!cancelled) setToolNames(entries.map((entry) => entry.name));
      })
      .catch(() => {
        if (!cancelled) {
          setToolNames([]);
          setToolsError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [definitionId, setNodes, setEdges, setViewport]);

  // 未保存保护：页面关闭拦截
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // dirty 上抛：外层（侧栏入口等）切走编辑器前也要确认
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const errorNodeIds = useMemo(
    () =>
      new Set(
        validationErrors
          .map((error) => error.nodeId)
          .filter((id): id is string => typeof id === "string"),
      ),
    [validationErrors],
  );

  const nodesWithHighlight = useMemo(
    () =>
      nodes.map((node) =>
        errorNodeIds.has(node.id) ? { ...node, className: "wc-node-invalid" } : node,
      ),
    [nodes, errorNodeIds],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // 只有用户改动（拖拽位置/增删）才算 dirty；dimensions/select 是运行时事件
      if (changes.some((change) => change.type === "position" || change.type === "remove" || change.type === "add")) {
        markDirty();
        setValidationErrors([]);
      }
      const selectChanges = changes.filter((change) => change.type === "select");
      const last = selectChanges[selectChanges.length - 1];
      if (last && "id" in last) {
        setSelectedNodeId(last.selected ? last.id : null);
      }
    },
    [onNodesChange, markDirty],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      if (changes.some((change) => change.type === "remove" || change.type === "add")) {
        markDirty();
        setValidationErrors([]);
      }
    },
    [onEdgesChange, markDirty],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge({ ...connection, id: createNodeId() }, current));
      setValidationErrors([]);
      markDirty();
    },
    [setEdges, markDirty],
  );

  const isConnectionAllowed = useCallback(
    (connection: Connection | Edge) =>
      isValidConnection(nodes, edges, {
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      }),
    [nodes, edges],
  );

  const addNode = useCallback(
    (type: WorkflowNodeType, position: { x: number; y: number }) => {
      setNodes((current) => [...current, createEditorNode(type, position, toolNames)]);
      setValidationErrors([]);
      markDirty();
    },
    [setNodes, toolNames, markDirty],
  );

  const addNodeAtCenter = useCallback(
    (type: WorkflowNodeType) => addNode(type, { x: 160, y: 120 }),
    [addNode],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/wc-node") as WorkflowNodeType;
      if (!type) return;
      addNode(type, dropPosition(".agent-editor-canvas", event.clientX, event.clientY));
    },
    [addNode],
  );

  const onNodeDataChange = useCallback(
    (nodeId: string, data: EditorNode["data"]) => {
      setNodes((current) =>
        current.map((node) => (node.id === nodeId ? { ...node, data } : node)),
      );
      setValidationErrors([]);
      markDirty();
    },
    [setNodes, markDirty],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { x, y, zoom } = getViewport();
      const graph = serializeGraph(nodes, edges, { x, y, zoom });
      const result = validateWorkflowGraph(graph, { toolNames });
      if (!result.ok) {
        setValidationErrors(result.errors);
        return;
      }
      setValidationErrors([]);
      await updateCustomAgent(definitionId, { name, graph: result.graph });
      setDirty(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, name, toolNames, definitionId, getViewport]);

  const handleExit = useCallback(() => {
    if (dirty && !window.confirm("有未保存的修改，确定离开编辑器吗？")) {
      return;
    }
    onExit();
  }, [dirty, onExit]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  if (loadError !== null) {
    return (
      <div className="session-gate" role="alert">
        <div className="session-gate-title">定义加载失败</div>
        <p className="session-gate-body">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="agent-editor">
      <div className="agent-editor-topbar">
        <button type="button" className="agent-manager-back" onClick={handleExit}>
          <ArrowLeft size={15} aria-hidden />
          <span>返回管理区</span>
        </button>
        <span className="agent-editor-name">{name}</span>
        {dirty && <span className="agent-editor-dirty">未保存更改</span>}
        <button
          type="button"
          className="primary agent-manager-new"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          <Save size={14} aria-hidden />
          <span>{saving ? "保存中…" : "保存"}</span>
        </button>
      </div>

      {validationErrors.length > 0 && (
        <div className="agent-editor-errors" role="alert">
          {validationErrors.map((error, index) => (
            <div key={index} className="agent-editor-error-row">
              {error.message}
            </div>
          ))}
        </div>
      )}
      {saveError !== null && (
        <div className="agent-editor-errors" role="alert">
          <div className="agent-editor-error-row">{saveError}</div>
        </div>
      )}

      <div className="agent-editor-body">
        <aside className="agent-editor-palette">
          <div className="nav-title">节点</div>
          {PALETTE.map((type) => (
            <PaletteCard key={type} type={type} onAdd={addNodeAtCenter} />
          ))}
          {toolsError && (
            <p className="agent-binding-hint">工具注册表加载失败：工具节点保存可能因 unknown_tool 被拒绝。</p>
          )}
        </aside>

        <div
          className="agent-editor-canvas"
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
        >
          <ReactFlow
            nodes={nodesWithHighlight}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            isValidConnection={isConnectionAllowed}
            nodeTypes={nodeTypes}
            colorMode="light"
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="agent-editor-inspector">
          <div className="nav-title">属性</div>
          {selectedNode === null ? (
            <p className="agent-binding-hint">选中一个节点以编辑其属性。</p>
          ) : (
            <NodeInspector
              node={selectedNode}
              toolNames={toolNames}
              onChange={(data) => onNodeDataChange(selectedNode.id, data)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeInspector({
  node,
  toolNames,
  onChange,
}: {
  node: EditorNode;
  toolNames: string[];
  onChange: (data: EditorNode["data"]) => void;
}) {
  switch (node.type) {
    case "start":
      return <p className="agent-binding-hint">开始节点接收用户消息，无需配置。</p>;
    case "llm":
      return <LlmInspector node={node} onChange={onChange} />;
    case "tool":
      return <ToolInspector node={node} toolNames={toolNames} onChange={onChange} />;
    case "condition":
      return <ConditionInspector node={node} onChange={onChange} />;
    case "end":
      return <EndInspector node={node} onChange={onChange} />;
    default:
      return null;
  }
}

function LlmInspector({
  node,
  onChange,
}: {
  node: EditorNode;
  onChange: (data: EditorNode["data"]) => void;
}) {
  const data = node.data as { prompt: string };
  return (
    <div className="wc-inspector-fields">
      <label className="wc-field-label">提示词（支持 {"{{节点id.output}}"} 插值）</label>
      <textarea
        className="nodrag wc-inspector-text"
        rows={8}
        value={data.prompt}
        onChange={(event) => onChange({ ...data, prompt: event.target.value })}
      />
    </div>
  );
}

function ToolInspector({
  node,
  toolNames,
  onChange,
}: {
  node: EditorNode;
  toolNames: string[];
  onChange: (data: EditorNode["data"]) => void;
}) {
  const data = node.data as { toolName: string; args: Record<string, unknown> };
  const [argsText, setArgsText] = useState(() => JSON.stringify(data.args, null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);

  // 切换节点时重置编辑缓冲；编辑过程中不同步（避免光标跳动）
  useEffect(() => {
    setArgsText(JSON.stringify(data.args, null, 2));
    setArgsError(null);
  }, [node.id]);

  return (
    <div className="wc-inspector-fields">
      <label className="wc-field-label">工具</label>
      <select
        className="nodrag agent-binding-select"
        value={data.toolName}
        onChange={(event) => onChange({ ...data, toolName: event.target.value })}
      >
        {toolNames.map((toolName) => (
          <option key={toolName} value={toolName}>
            {toolName}
          </option>
        ))}
      </select>
      <label className="wc-field-label">参数（JSON，字符串值支持插值）</label>
      <textarea
        className="nodrag wc-inspector-text"
        rows={6}
        value={argsText}
        onChange={(event) => {
          setArgsText(event.target.value);
          try {
            const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
            if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
              setArgsError("参数必须是 JSON 对象");
              return;
            }
            setArgsError(null);
            onChange({ ...data, args: parsed });
          } catch {
            setArgsError("JSON 格式不正确");
          }
        }}
      />
      {argsError !== null && (
        <div className="field-error" role="alert">
          {argsError}
        </div>
      )}
    </div>
  );
}

function ConditionInspector({
  node,
  onChange,
}: {
  node: EditorNode;
  onChange: (data: EditorNode["data"]) => void;
}) {
  const data = node.data as { branches: ConditionBranch[] };

  const updateBranch = (branchId: string, patch: Partial<ConditionBranch>) => {
    onChange({
      branches: data.branches.map((branch) =>
        branch.id === branchId ? { ...branch, ...patch } : branch,
      ),
    });
  };

  const updateExpression = (
    branch: ConditionBranch,
    patch: Partial<ConditionExpression>,
  ) => {
    if (!branch.expression) return;
    updateBranch(branch.id, { expression: { ...branch.expression, ...patch } });
  };

  return (
    <div className="wc-inspector-fields">
      {data.branches.map((branch, index) => {
        const isFallback = branch.expression === undefined;
        return (
          <div key={branch.id} className="wc-branch-editor">
            <div className="wc-branch-editor-head">
              <span>{isFallback ? "兜底分支" : `分支 ${index + 1}`}</span>
              {data.branches.length > 2 && (
                <button
                  type="button"
                  className="wc-branch-remove"
                  onClick={() =>
                    onChange({
                      branches: data.branches.filter((candidate) => candidate.id !== branch.id),
                    })
                  }
                >
                  删除
                </button>
              )}
            </div>
            {!isFallback && branch.expression && (
              <div className="wc-expression-row">
                <input
                  className="nodrag"
                  value={branch.expression.left}
                  placeholder="左侧（可插值）"
                  onChange={(event) =>
                    updateExpression(branch, { left: event.target.value })
                  }
                />
                <select
                  className="nodrag"
                  value={branch.expression.op}
                  onChange={(event) =>
                    updateExpression(branch, {
                      op: event.target.value as ConditionOperator,
                    })
                  }
                >
                  {OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {operator}
                    </option>
                  ))}
                </select>
                <input
                  className="nodrag"
                  value={branch.expression.right}
                  placeholder="右侧（可插值）"
                  onChange={(event) =>
                    updateExpression(branch, { right: event.target.value })
                  }
                />
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="wc-branch-add"
        onClick={() => {
          const fallback = data.branches.filter((branch) => branch.expression === undefined);
          const withExpression = data.branches.filter((branch) => branch.expression !== undefined);
          onChange({
            branches: [
              ...withExpression,
              { id: createBranchId(), expression: { left: "", op: "equals", right: "" } },
              ...fallback,
            ],
          });
        }}
      >
        添加分支
      </button>
    </div>
  );
}

function EndInspector({
  node,
  onChange,
}: {
  node: EditorNode;
  onChange: (data: EditorNode["data"]) => void;
}) {
  const data = node.data as { output: string };
  return (
    <div className="wc-inspector-fields">
      <label className="wc-field-label">输出（支持 {"{{节点id.output}}"} 插值）</label>
      <textarea
        className="nodrag wc-inspector-text"
        rows={6}
        value={data.output}
        onChange={(event) => onChange({ ...data, output: event.target.value })}
      />
    </div>
  );
}
