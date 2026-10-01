import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, Pencil, Plus, SquarePen, Trash2 } from "lucide-react";
import {
  createCustomAgent,
  deleteCustomAgent,
  listCustomAgentSummaries,
  renameCustomAgent,
  type CustomAgentSummary,
} from "./custom-agent-api";
import { countCustomAgentReferences, type WorkspaceState } from "./workspace-state";
import { ConfirmDialog, Modal } from "./workspace-ui";

// 侧栏"自定义 Agent"管理区：定义列表 / 新建 / 重命名 / 删除（删除保护在前端）。
// 编辑器（画布）由后续票实现，本视图的编辑入口暂为禁用占位。

export function AgentManagerView({
  workspace,
  onExit,
}: {
  workspace: WorkspaceState;
  onExit: () => void;
}) {
  const [summaries, setSummaries] = useState<CustomAgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "create" }
    | { kind: "rename"; agent: CustomAgentSummary }
    | { kind: "delete"; agent: CustomAgentSummary }
    | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      setSummaries(await listCustomAgentSummaries({ force: true }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 新建 / 重命名 / 删除的共用收尾：成功后刷新列表，失败把错误亮在列表区。
  const runMutation = useCallback(
    (promise: Promise<unknown>, failureMessage: string) => {
      void promise
        .then(refresh)
        .catch((mutationError: unknown) =>
          setError(
            mutationError instanceof Error ? `${failureMessage}：${mutationError.message}` : failureMessage,
          ),
        );
    },
    [refresh],
  );

  return (
    <div className="agent-manager">
      <div className="agent-manager-header">
        <button type="button" className="agent-manager-back" onClick={onExit}>
          <ArrowLeft size={15} aria-hidden />
          <span>返回聊天</span>
        </button>
        <div className="agent-manager-title">
          <Bot size={17} aria-hidden />
          <span>自定义 Agent</span>
        </div>
        <button
          type="button"
          className="primary agent-manager-new"
          onClick={() => setDialog({ kind: "create" })}
        >
          <Plus size={14} aria-hidden />
          <span>新建</span>
        </button>
      </div>

      <div className="agent-list">
        {error !== null && (
          <div className="agent-manager-status" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        )}
        {error === null && summaries === null && (
          <div className="agent-manager-status">加载中…</div>
        )}
        {error === null && summaries !== null && summaries.length === 0 && (
          <div className="agent-manager-status">
            <p>还没有自定义 Agent。</p>
            <p className="agent-manager-hint">新建一个，用可视化画布编排它的行为。</p>
          </div>
        )}
        {error === null &&
          summaries?.map((agent) => {
            const references = countCustomAgentReferences(workspace.projects, agent.id);
            return (
              <div key={agent.id} className="agent-row">
                <span className="agent-row-icon" aria-hidden>
                  <Bot size={16} />
                </span>
                <div className="agent-row-main">
                  <div className="agent-row-name">{agent.name}</div>
                  <div className="agent-row-meta">
                    更新于 {new Date(agent.updatedAt).toLocaleString("zh-CN")}
                    {references > 0 && (
                      <span className="agent-row-ref"> · 被 {references} 个项目引用</span>
                    )}
                  </div>
                </div>
                <span className="agent-row-actions">
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={`编辑 ${agent.name}`}
                    title="画布编辑器即将提供"
                    disabled
                  >
                    <SquarePen size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={`重命名 ${agent.name}`}
                    title="重命名"
                    onClick={() => setDialog({ kind: "rename", agent })}
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={`删除 ${agent.name}`}
                    title={references > 0 ? `被 ${references} 个项目引用，无法删除` : "删除"}
                    disabled={references > 0}
                    onClick={() => setDialog({ kind: "delete", agent })}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </span>
              </div>
            );
          })}
      </div>

      {dialog?.kind === "create" && (
        <AgentNameDialog
          mode="create"
          onSubmit={(name) => runMutation(createCustomAgent(name), "创建失败")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <AgentNameDialog
          mode="rename"
          initialName={dialog.agent.name}
          onSubmit={(name) =>
            runMutation(renameCustomAgent(dialog.agent.id, name), "重命名失败")
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="删除自定义 Agent"
          body={`删除“${dialog.agent.name}”？此操作不可撤销，引用它的项目将显示错误态。`}
          confirmLabel="删除"
          onConfirm={() =>
            runMutation(deleteCustomAgent(dialog.agent.id), "删除失败")
          }
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function AgentNameDialog({
  mode,
  initialName = "",
  onSubmit,
  onClose,
}: {
  mode: "create" | "rename";
  initialName?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isCreate = mode === "create";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("请输入名称");
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal label={isCreate ? "新建自定义 Agent" : "重命名自定义 Agent"} onClose={onClose}>
      <h2>{isCreate ? "新建自定义 Agent" : "重命名自定义 Agent"}</h2>
      {isCreate && (
        <p>创建后会自带一个 start → LLM → 结束 的默认模板图，开箱即可对话。</p>
      )}
      <input
        ref={inputRef}
        value={name}
        placeholder="例如：翻译小助手"
        aria-label="Agent 名称"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      />
      <div className="field-error" role="alert" title={error ?? undefined}>
        {error ?? ""}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="button" className="primary" onClick={submit}>
          {isCreate ? "创建" : "保存"}
        </button>
      </div>
    </Modal>
  );
}
