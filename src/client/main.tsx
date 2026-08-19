import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CopilotChatView,
  CopilotKit,
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";
import {
  createProject,
  createSession,
  deleteProject,
  deleteSession,
  groupSessionHistory,
  loadWorkspace,
  reconcileSessionMessages,
  renameProject,
  renameSession,
  saveWorkspace,
  setSessionMessages,
  switchProject,
  switchSession,
  type HistoryScope,
  type Session,
  type SessionHistoryGroups,
  type WorkspaceState,
} from "./workspace-state";

const resourceId =
  localStorage.getItem("mastra-resource-id") ?? crypto.randomUUID();
localStorage.setItem("mastra-resource-id", resourceId);

const HISTORY_GROUP_LABELS: Array<[keyof SessionHistoryGroups, string]> = [
  ["today", "今天"],
  ["yesterday", "昨天"],
  ["earlier", "更早"],
];

function App() {
  const [initialLoad] = useState(() => loadWorkspace(localStorage));
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialLoad.workspace);
  const [notice, setNotice] = useState<string | null>(
    initialLoad.recovered
      ? "工作区数据已重置，之前的本地记录无法恢复。"
      : null,
  );
  const [historyScope, setHistoryScope] = useState<HistoryScope>({
    kind: "project",
    projectId: initialLoad.workspace.activeProjectId,
  });

  // 轻量节流：消息流式更新会频繁改变工作区，延迟合并写入 localStorage。
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const result = saveWorkspace(localStorage, workspace);
      if (!result.saved) {
        setNotice(`工作区保存失败：${result.error}`);
      }
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [workspace]);

  const activeSession = workspace.sessions.find(
    (session) => session.id === workspace.activeSessionId,
  );
  if (!activeSession) {
    throw new Error("Active session missing from workspace");
  }
  const activeProject = workspace.projects.find(
    (project) => project.id === workspace.activeProjectId,
  );
  if (!activeProject) {
    throw new Error("Active project missing from workspace");
  }

  const historyGroups = groupSessionHistory(workspace, undefined, historyScope);

  // historyScope 指向的项目被删除后，回退到新的 Active Project。
  useEffect(() => {
    if (
      historyScope.kind === "project" &&
      !workspace.projects.some((project) => project.id === historyScope.projectId)
    ) {
      setHistoryScope({ kind: "project", projectId: workspace.activeProjectId });
    }
  }, [workspace, historyScope]);

  const handleMessagesChange = useCallback(
    (messages: Message[]) => {
      setWorkspace((current) =>
        setSessionMessages(current, activeSession.id, messages),
      );
    },
    [activeSession.id],
  );

  const handleSelectScope = (value: string) => {
    if (value === "__create__") {
      const name = window.prompt("项目名称");
      if (!name || !name.trim()) return;
      // 预生成 id：StrictMode 会重复执行 updater，id 必须保持确定
      const ids = [crypto.randomUUID(), crypto.randomUUID()];
      let call = 0;
      setWorkspace((current) =>
        createProject(current, name.trim(), {
          createId: () => ids[call++ % 2]!,
        }),
      );
      setHistoryScope({ kind: "project", projectId: ids[0]! });
      return;
    }
    if (value === "unclassified" || value === "all") {
      setHistoryScope({ kind: value });
      return;
    }
    setWorkspace((current) => switchProject(current, value));
    setHistoryScope({ kind: "project", projectId: value });
  };

  const handleRenameProject = () => {
    const name = window.prompt("重命名项目", activeProject.name);
    if (name && name.trim()) {
      setWorkspace((current) =>
        renameProject(current, activeProject.id, name.trim()),
      );
    }
  };

  const handleDeleteProject = () => {
    if (
      !window.confirm(`删除项目“${activeProject.name}”？其中的会话会移到未分类。`)
    ) {
      return;
    }
    setWorkspace((current) => deleteProject(current, activeProject.id));
  };

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{ "x-mastra-resource-id": resourceId }}
    >
      <main className="app-shell">
        <aside className="session-sidebar">
          <div className="project-selector">
            <select
              aria-label="项目上下文选择器"
              value={
                historyScope.kind === "project"
                  ? historyScope.projectId
                  : historyScope.kind
              }
              onChange={(event) => handleSelectScope(event.target.value)}
            >
              <optgroup label="项目">
                {workspace.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
              <option value="unclassified">未分类</option>
              <option value="all">全部历史</option>
              <option value="__create__">＋ 新建项目</option>
            </select>
            {historyScope.kind === "project" && (
              <span className="project-actions">
                <button type="button" onClick={handleRenameProject}>
                  改名
                </button>
                <button type="button" onClick={handleDeleteProject}>
                  删除
                </button>
              </span>
            )}
          </div>
          {(historyScope.kind !== "project" ||
            historyScope.projectId !== activeProject.id) && (
            <p className="active-project-caption">当前项目：{activeProject.name}</p>
          )}
          <button
            type="button"
            className="new-session-button"
            onClick={() => setWorkspace((current) => createSession(current))}
          >
            + 新建会话
          </button>
          <nav className="session-history" aria-label="会话历史">
            {HISTORY_GROUP_LABELS.map(([key, label]) =>
              historyGroups[key].length === 0 ? null : (
                <section className="session-group" key={key}>
                  <h2>{label}</h2>
                  <ul>
                    {historyGroups[key].map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        active={session.id === workspace.activeSessionId}
                        onOpen={() =>
                          setWorkspace((current) =>
                            switchSession(current, session.id),
                          )
                        }
                        onRename={() => {
                          const title = window.prompt("重命名会话", session.title);
                          if (title && title.trim()) {
                            setWorkspace((current) =>
                              renameSession(current, session.id, title.trim()),
                            );
                          }
                        }}
                        onDelete={() => {
                          if (window.confirm(`删除会话“${session.title}”？`)) {
                            setWorkspace((current) =>
                              deleteSession(current, session.id),
                            );
                          }
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ),
            )}
          </nav>
        </aside>
        <section className="intro-panel">
          <p className="eyebrow">WEATHER DESK / 01</p>
          <h1>Plan the day around the sky.</h1>
          <p className="lede">
            Ask for current conditions, a forecast, or a weather-aware plan for
            your next trip.
          </p>
          <div className="prompt-grid" aria-label="Suggested prompts">
            <span>Beijing this weekend</span>
            <span>Rain-safe afternoon in London</span>
            <span>What should I pack for Tokyo?</span>
          </div>
          <p className="status-line"><span /> Live weather assistant</p>
        </section>
        <section className="chat-panel">
          <header className="chat-header">{activeSession.title}</header>
          <WorkspaceChat
            session={activeSession}
            onMessagesChange={handleMessagesChange}
          />
        </section>
      </main>
      {notice && (
        <div
          className="workspace-notice"
          role="status"
          onClick={() => setNotice(null)}
        >
          {notice}
        </div>
      )}
    </CopilotKit>
  );
}

function SessionItem({
  session,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={active ? "session-item active" : "session-item"}>
      <button type="button" className="session-open" onClick={onOpen}>
        {session.title}
      </button>
      <span className="session-actions">
        <button type="button" onClick={onRename} aria-label="重命名会话">
          改名
        </button>
        <button type="button" onClick={onDelete} aria-label="删除会话">
          删除
        </button>
      </span>
    </li>
  );
}

function WorkspaceChat({
  session,
  onMessagesChange,
}: {
  session: Session;
  onMessagesChange: (messages: Message[]) => void;
}) {
  const { agent } = useAgent({
    agentId: `workspace-session-${session.id}`,
    runtimeAgentId: "weatherAgent",
    threadId: session.id,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const sync = reconcileSessionMessages(agent.messages, session.messages);
    if (sync === "restore-snapshot") {
      // 切换到有历史快照的会话：回填完整 Message Snapshot。
      agent.setMessages(session.messages);
    } else if (sync === "save-snapshot") {
      onMessagesChange(agent.messages);
    }
  }, [agent, agent.messages, session, onMessagesChange]);

  return (
    <CopilotChatView
      className="chat-view"
      messages={agent.messages}
      isRunning={agent.isRunning}
      onSubmitMessage={async (text) => {
        agent.addMessage({
          id: crypto.randomUUID(),
          role: "user",
          content: text,
        });
        await copilotkit.runAgent({ agent });
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
