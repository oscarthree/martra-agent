# 调研 @xyflow/react 与 React 19 前端集成要点

- Type: `wayfinder:research`
- Parent map: [自定义 Agent 工作流编排](../maps/custom-agent-workflow-builder.md)
- Status: closed
- Blocking: 设计自定义 Agent 前端 UX 与编辑器

## Question

在本前端栈（React 19 + Vite + CopilotKit，样式变量 `--wc-*` 前缀）里集成 `@xyflow/react`（React Flow v12）的关键事实：与 React 19 的兼容性与当前版本、受控 nodes/edges 状态模型（useNodesState / onNodesChange）、自定义节点与边的渲染方式、图的序列化/反序列化 API（toObject 等）、必须引入的样式与主题隔离注意点、与 Vite 构建的兼容性。

## Resolution

### 1. 版本与 React 19 兼容性

npm registry 显示最新稳定版为 **`@xyflow/react@12.11.6`**（React Flow v12 线）。其 `peerDependencies` 为 `react: ">=17"`、`react-dom: ">=17"`（含 `@types/react: ">=17"`），区间覆盖 React 19。GitHub issue [xyflow/xyflow#4893](https://github.com/xyflow/xyflow/issues/4893)（Conflict dependency React 19）中维护者确认 React Flow 已可在 React 19 下工作，安装冲突只需重装 node_modules 即可解决。运行时依赖仅 `zustand`、`classcat`、`@xyflow/system`，无已知阻断性 React 19 兼容问题。结论：可直接安装最新 12.x 与本项目 React 19 共存。

来源：https://registry.npmjs.org/@xyflow/react/latest ；https://github.com/xyflow/xyflow/issues/4893

### 2. 受控状态模型

官方核心模式：受控（controlled）画布把 nodes/edges 放在本地 state，所有交互（拖拽、选中、删除、连线）都通过 change 数组回调，由 `applyNodeChanges` / `applyEdgeChanges` / `addEdge` 应用到 state；`useNodesState` / `useEdgesState` 是 `useState` + 预置 `onNodesChange` / `onEdgesChange` 的便捷封装。非受控（uncontrolled）模式用 `defaultNodes` / `defaultEdges` 初始化、内部自管状态，之后只能通过 `useReactFlow()` 实例方法（`addNodes` 等）修改。对"序列化图 JSON 存后端"的编辑器场景应选**受控**：数据在本地 state 中，随时可序列化/校验/撤销。

受控画布骨架（官方 Quick Start 形态）：

```tsx
import { useCallback } from 'react';
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export default function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}> {/* 父容器必须有宽高 */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        colorMode="light"
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

来源：https://reactflow.dev/learn/getting-started/installation-and-requirements ；https://reactflow.dev/learn/advanced-use/uncontrolled-flow ；https://reactflow.dev/learn/advanced-use/state-management

### 3. 自定义节点与边

- 自定义节点就是普通 React 组件，React Flow 会包裹并注入 `id` / `data` / `position` 等 props；官方明确建议**不用内置节点、全部自定义**，可在节点内嵌入表单输入、图表等任意 UI。
- 连线点用 `<Handle type="source|target" position={Position.*} />`；同类型多 handle 必须给唯一 `id`，边上用 `sourceHandle` / `targetHandle` 对应。
- 表单控件必须加 `className="nodrag"`，否则在控件上按下会拖走整个节点（同理有 `nopan` / `nowheel`）。
- 节点可缩放用官方内置 `<NodeResizer />`（v12 已并入 `@xyflow/react`，不需单独包）。
- `nodeTypes` / `edgeTypes` **必须在组件外定义或用 `useMemo`**，内联定义会触发官方警告并导致每次 render 全量重渲染（经典坑，见第 7 点）。
- 自定义边用 `<BaseEdge />` + `getBezierPath` / `getSmoothStepPath` 等路径函数渲染 SVG path，注册到 `edgeTypes`，edge 上设 `type` 匹配。

自定义节点骨架（含 Handle 与表单控件）：

```tsx
import { memo } from 'react';
import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';

type FormNodeType = Node<{ prompt: string }, 'formNode'>;

export const FormNode = memo(function FormNode({ id, data }: NodeProps<FormNodeType>) {
  const { updateNodeData } = useReactFlow(); // v12 提供，直接写回 data

  return (
    <div className="wc-flow-node">
      <Handle type="target" position={Position.Left} />
      <label htmlFor="prompt">提示词</label>
      <input
        id="prompt"
        className="nodrag"
        value={data.prompt}
        onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

// 组件外定义，禁止内联
const nodeTypes = { formNode: FormNode };
```

注意节点 data 更新必须产生新对象（`{ ...node, data: { ...node.data, x } }`），React Flow 靠引用变化感知更新。节点内写 state 推荐 `updateNodeData`（v12 新 API）或官方 state-management 页展示的 Zustand store 模式，而不是把回调塞进 `data`（序列化时函数不可持久化）。

来源：https://reactflow.dev/learn/customization/custom-nodes ；https://reactflow.dev/learn/customization/handles ；https://reactflow.dev/learn/customization/custom-edges ；https://reactflow.dev/learn/advanced-use/state-management

### 4. 序列化 / 反序列化

官方 Save & Restore 示例给出的模式：通过 `onInit={setRfInstance}` 或 `useReactFlow()` 拿到 `ReactFlowInstance`，`instance.toObject()` 产出可直接 JSON 化的对象，形状为：

```json
{
  "nodes": [{ "id": "1", "type": "formNode", "position": { "x": 0, "y": -50 }, "data": { "prompt": "..." }, "measured": { "width": 150, "height": 40 } }],
  "edges": [{ "id": "e1-2", "source": "1", "target": "2", "sourceHandle": null, "targetHandle": null }],
  "viewport": { "x": 120.5, "y": 40, "zoom": 1 }
}
```

恢复：

```tsx
const restoreFlow = async () => {
  const flow = JSON.parse(savedJson);
  if (!flow) return;
  const { x = 0, y = 0, zoom = 1 } = flow.viewport;
  setNodes(flow.nodes || []);
  setEdges(flow.edges || []);
  setViewport({ x, y, zoom }); // 来自 useReactFlow()
};
```

要点：`setViewport` 来自 `useReactFlow()`，该 hook 只能在 `<ReactFlowProvider>` 的子组件中调用，因此编辑器外层必须包 `<ReactFlowProvider>`（Provider 与 `<ReactFlow>` 不能在同一组件内同时混用 `useReactFlow`，否则报 zustand provider 错误）。后端持久化建议只存 `toObject()` 的子集（nodes 的 `id/type/position/data`、edges、viewport），剔除 `measured`/`selected` 等运行时字段。

来源：https://reactflow.dev/examples/interaction/save-and-restore ；https://reactflow.dev/learn/troubleshooting

### 5. 样式与主题

- **必须** `import '@xyflow/react/dist/style.css'`（不引入则节点/边不显示，官方有专门警告）；若完全自写主题，至少引入 `dist/base.css`（功能必需）。
- 内置深浅主题用 `colorMode="light" | "dark" | "system"`（默认 `light`），机制是往根元素 `.react-flow` 上加 `.light` / `.dark` class。本项目是浅色主题，固定 `colorMode="light"` 即可。
- CSS 变量全部为 `--xy-*-default` 前缀（如 `--xy-node-background-color-default`、`--xy-edge-stroke-default`），定义在 `.react-flow` 和 `:root` 上；内置 class 为 `.react-flow__*`。**与本项目 `--wc-*` 前缀无冲突风险**——变量命名空间完全隔离，xyflow 类名也足够具体；反向风险是本项目的全局样式（如全局 `input` 样式）泄漏进节点内部，覆盖时注意以 `.react-flow` 为作用域锚点覆写变量。
- 官方变量覆写方式：`.react-flow { --xy-node-background-color-default: #ff5050; }`。

来源：https://reactflow.dev/learn/customization/theming ；https://reactflow.dev/api-reference/react-flow

### 6. Vite 集成

官方 Quick Start 推荐且示范的脚手架就是 Vite；包提供 ESM 入口（`exports` 中 `import` 指向 `dist/esm/index.js`），CSS 通过普通 `import '@xyflow/react/dist/style.css'` 引入即可被 Vite 处理，无需任何插件或配置。troubleshooting 页中唯一的构建问题针对 webpack 4（需 babel 转译），与 Vite 无关。无已知 Vite 特定问题。

来源：https://reactflow.dev/learn/getting-started/installation-and-requirements ；https://reactflow.dev/learn/troubleshooting

### 7. 常见坑（官方 troubleshooting/performance 页归纳）

- **节点 id 必须唯一且不要用数组 index**：官方示例用 `getNodeId = () => \`randomnode_${+new Date()}\`` 或自增计数器生成字符串 id；id 是节点/边引用与序列化的键，重复或 index 化会导致删除/连线错乱。
- **nodeTypes/edgeTypes 内联定义**：每次 render 创建新对象 → React Flow 判定类型表变化并全量重渲染，官方直接给警告；必须在组件外定义或 `useMemo`。自定义节点组件本身也应 `memo`。
- **事件处理函数引用不稳定**：`onNodesChange` 等 handler 必须 `useCallback`（或定义在组件外），否则可能触发无限重渲染循环。
- **拖拽性能**：拖动节点时每个 mousemove 都产生 position change，受控模式下意味着每帧 `setNodes` 全量重渲染。缓解手段：节点组件 `memo`、不要在节点/视口组件里直接订阅整个 `nodes` 数组、大图开 `onlyRenderVisibleElements`；一般规模的编排画布（几十个节点）无需 throttle，`useNodesState` 默认模式即官方推荐做法。
- **连线同步**：`onConnect` 里必须用 `addEdge(connection, edges)` 辅助函数把 connection 转成完整 edge 再合并；业务校验用 `<ReactFlow isValidConnection={fn}>`（官方说明出于性能原因优于在单个 Handle 上设 `isValidConnection`）。
- **删除连带**：键盘删除（默认 `Backspace`，`deleteKeyCode` 可配）删除节点时 React Flow 会自动把相连边一并删除；编程式删除时可用 `getConnectedEdges` / `getIncomers` / `getOutgoers` 工具函数计算连带边。
- **其他高频警告**：父容器必须显式宽高（否则画布不渲染）；隐藏 handle 用 `opacity: 0` 而非 `display: none`（后者宽高为 0，边定位失效）；动态增删 handle 后必须调 `useUpdateNodeInternals()`；边必须有 `source` + `target`；自定义节点忘记放 `<Handle>` 会导致边完全画不出来。

来源：https://reactflow.dev/learn/troubleshooting ；https://reactflow.dev/learn/advanced-use/performance ；https://reactflow.dev/api-reference/react-flow

### 对 Dify 风格编辑器 UX 决策的支撑小结

开箱即用的能力足以覆盖 Dify 画布的主体交互：平移/缩放/框选/自动贴边（autoPan）、拖拽节点、拖线连接（含 connection line、`connectionRadius` 吸附、click-to-connect）、键盘删除与连带边清理、节点缩放（NodeResizer）、背景网格/Minimap/Controls 组件、连线重连（`onReconnect` + `reconnectEdge`）、`colorMode` 主题与 CSS 变量级品牌定制、以及 `toObject()` 直接产出可持久化的 `{ nodes, edges, viewport }` JSON。需要自己造的部分集中在业务层：左侧节点面板与拖入画布的 DnD 接线（官方有 Drag and Drop 示例可抄）、节点表单 schema 与 `node.data` 的双向同步（`updateNodeData` 或 Zustand store）、连线业务规则（`isValidConnection` 如禁止环/类型匹配）、与后端约定的图 JSON 契约与版本迁移、撤销/重做栈、自动布局（可接 dagre/elk，官方有布局示例）以及运行态高亮。总体判断：`@xyflow/react` 与本项目栈（React 19 + Vite + `--wc-*` 浅色主题）无集成障碍，编排编辑器可以作为纯前端模块落地，后端只需存图 JSON。

参考来源汇总：

- https://registry.npmjs.org/@xyflow/react/latest
- https://github.com/xyflow/xyflow/issues/4893
- https://reactflow.dev/learn/getting-started/installation-and-requirements
- https://reactflow.dev/learn/advanced-use/uncontrolled-flow
- https://reactflow.dev/learn/advanced-use/state-management
- https://reactflow.dev/learn/advanced-use/performance
- https://reactflow.dev/learn/customization/custom-nodes
- https://reactflow.dev/learn/customization/custom-edges
- https://reactflow.dev/learn/customization/handles
- https://reactflow.dev/learn/customization/theming
- https://reactflow.dev/learn/troubleshooting
- https://reactflow.dev/examples/interaction/save-and-restore
- https://reactflow.dev/api-reference/react-flow
