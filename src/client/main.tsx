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
import { Menu as MenuIcon, Plus } from "lucide-react";
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
  validateProjectName,
  type HistoryScope,
  type Project,
  type Session,
  type WorkspaceState,
} from "./workspace-state";
import {
  ConfirmDialog,
  Drawer,
  ProjectContextSelector,
  ProjectFormDialog,
  SessionRenameDialog,
  SidebarContent,
} from "./workspace-ui";

const resourceId =
  localStorage.getItem("mastra-resource-id") ?? crypto.randomUUID();
localStorage.setItem("mastra-resource-id", resourceId);

type DialogState =
  | { kind: "project-create" }
  | { kind: "project-rename"; project: Project }
  | { kind: "session-rename"; session: Session }
  | { kind: "project-delete"; project: Project }
  | { kind: "session-delete"; session: Session }
  | null;

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const handleNewSession = useCallback(() => {
    setWorkspace((current) => createSession(current));
    closeDrawer();
  }, [closeDrawer]);

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setWorkspace((current) => switchProject(current, projectId));
      setHistoryScope({ kind: "project", projectId });
      closeDrawer();
    },
    [closeDrawer],
  );

  const handleOpenSession = useCallback((sessionId: string) => {
    setWorkspace((current) => switchSession(current, sessionId));
    closeDrawer();
  }, [closeDrawer]);

  const handleCreateProject = (name: string) => {
    // 预生成 id：StrictMode 会重复执行 updater，id 必须保持确定
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    let call = 0;
    setWorkspace((current) =>
      createProject(current, name, { createId: () => ids[call++ % 2]! }),
    );
    setHistoryScope({ kind: "project", projectId: ids[0]! });
  };

  const sidebar = (
    <SidebarContent
      workspace={workspace}
      historyScope={historyScope}
      groups={historyGroups}
      onNewSession={handleNewSession}
      onShowActiveProject={() => {
        setHistoryScope({ kind: "project", projectId: workspace.activeProjectId });
        closeDrawer();
      }}
      onShowAllHistory={() => {
        setHistoryScope({ kind: "all" });
        closeDrawer();
      }}
      onSelectProject={handleSelectProject}
      onOpenSession={handleOpenSession}
      onRenameSession={(session) => {
        // 弹窗挂载在抽屉之外：先关抽屉，避免焦点陷阱冲突
        setDrawerOpen(false);
        setDialog({ kind: "session-rename", session });
      }}
      onDeleteSession={(session) => {
        setDrawerOpen(false);
        setDialog({ kind: "session-delete", session });
      }}
    />
  );

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{ "x-mastra-resource-id": resourceId }}
      enableInspector={false}
    >
      <main className="workspace">
        <aside className="sidebar">{sidebar}</aside>
        <div className="main">
          <header className="topbar">
            <button
              type="button"
              ref={menuButtonRef}
              className="icon-button mobile-menu"
              aria-label="打开工作区菜单"
              title="打开工作区菜单"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon size={20} aria-hidden />
            </button>
            <ProjectContextSelector
              workspace={workspace}
              historyScope={historyScope}
              onSelectProject={handleSelectProject}
              onSelectUnclassified={() => setHistoryScope({ kind: "unclassified" })}
              onSelectAll={() => setHistoryScope({ kind: "all" })}
              onCreateProject={() => setDialog({ kind: "project-create" })}
              onRenameProject={(project) =>
                setDialog({ kind: "project-rename", project })
              }
              onDeleteProject={(project) =>
                setDialog({ kind: "project-delete", project })
              }
            />
            <div className="top-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="新建会话"
                title="新建会话"
                onClick={handleNewSession}
              >
                <Plus size={18} aria-hidden />
              </button>
            </div>
          </header>
          <section className="chat-panel">
            <WorkspaceChat
              session={activeSession}
              onMessagesChange={handleMessagesChange}
              sendError={chatError}
              onSendErrorChange={setChatError}
            />
          </section>
        </div>
        {drawerOpen && <Drawer onClose={closeDrawer}>{sidebar}</Drawer>}
      </main>

      {dialog?.kind === "project-create" && (
        <ProjectFormDialog
          mode="create"
          validate={(name) => validateProjectName(workspace, name)}
          onSubmit={handleCreateProject}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "project-rename" && (
        <ProjectFormDialog
          mode="rename"
          initialName={dialog.project.name}
          validate={(name) =>
            name.trim() === dialog.project.name
              ? null
              : validateProjectName(workspace, name)
          }
          onSubmit={(name) =>
            setWorkspace((current) =>
              renameProject(current, dialog.project.id, name),
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "session-rename" && (
        <SessionRenameDialog
          initialTitle={dialog.session.title}
          onSubmit={(title) =>
            setWorkspace((current) =>
              renameSession(current, dialog.session.id, title),
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "project-delete" && (
        <ConfirmDialog
          title="删除项目"
          body={`删除项目“${dialog.project.name}”？其中的会话会移到未分类，不会被删除。`}
          confirmLabel="删除项目"
          onConfirm={() =>
            setWorkspace((current) =>
              deleteProject(current, dialog.project.id),
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "session-delete" && (
        <ConfirmDialog
          title="删除会话"
          body={`删除会话“${dialog.session.title}”？此操作不可撤销。`}
          confirmLabel="删除会话"
          onConfirm={() =>
            setWorkspace((current) =>
              deleteSession(current, dialog.session.id),
            )
          }
          onClose={() => setDialog(null)}
        />
      )}

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

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-kicker">LIVE WEATHER ASSISTANT</div>
      <h1>今天想去哪里？</h1>
      <p className="welcome-copy">
        告诉我一个城市、天气问题，或者你的下一段旅程。我会结合实时天气，帮你把一天安排得更从容。
      </p>
      <div className="suggestions" aria-label="推荐问题">
        <button type="button" className="suggestion" onClick={() => onPick("北京周末天气怎么样？")}>
          北京周末天气
        </button>
        <button type="button" className="suggestion" onClick={() => onPick("帮我安排大连三天行程")}>
          大连三天行程
        </button>
        <button type="button" className="suggestion" onClick={() => onPick("东京今天适合带什么？")}>
          东京出行建议
        </button>
      </div>
    </div>
  );
}

function WorkspaceChat({
  session,
  onMessagesChange,
  sendError,
  onSendErrorChange,
}: {
  session: Session;
  onMessagesChange: (messages: Message[]) => void;
  sendError: string | null;
  onSendErrorChange: (error: string | null) => void;
}) {
  const { agent } = useAgent({
    agentId: `workspace-session-${session.id}`,
    runtimeAgentId: "weatherAgent",
    threadId: session.id,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();
  const [inputValue, setInputValue] = useState("");

  // runAgent 失败不会 reject：错误经 agent 订阅的 onRunFailed 上报
  useEffect(() => {
    const subscription = agent.subscribe({
      onRunFailed: () => onSendErrorChange("发送失败，请检查网络后重试。"),
    });
    return () => subscription.unsubscribe();
  }, [agent, onSendErrorChange]);

  // 每个会话首次进入时，无论快照是否为空都以快照为准：
  // 新会话的 agent 克隆会继承共享 runtime agent 上的旧消息，必须显式清掉。
  // 之后 agent 只可能比快照更新（流式增量），方向为 save-snapshot。
  const hydratedSessions = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hydratedSessions.current.has(session.id)) {
      hydratedSessions.current.add(session.id);
      agent.setMessages(session.messages);
      return;
    }
    const sync = reconcileSessionMessages(agent.messages, session.messages);
    if (sync === "restore-snapshot") {
      agent.setMessages(session.messages);
    } else if (sync === "save-snapshot") {
      onMessagesChange(agent.messages);
    }
  }, [agent, agent.messages, session, onMessagesChange]);

  const runAgent = async () => {
    try {
      onSendErrorChange(null);
      await copilotkit.runAgent({ agent });
    } catch {
      onSendErrorChange("发送失败，请检查网络后重试。");
    }
  };

  return (
    <CopilotChatView
      messages={agent.messages}
      isRunning={agent.isRunning}
      welcomeScreen={false}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onSubmitMessage={async (text) => {
        agent.addMessage({
          id: crypto.randomUUID(),
          role: "user",
          content: text,
        });
        setInputValue("");
        await runAgent();
      }}
    >
      {({ scrollView, input }) => (
        <>
          <div className="chat-scroll">
            {agent.messages.length === 0 ? (
              <Welcome onPick={setInputValue} />
            ) : (
              scrollView
            )}
          </div>
          {sendError && (
            <div className="send-error" role="alert">
              <span>{sendError}</span>
              <span className="send-error-actions">
                <button type="button" onClick={() => void runAgent()}>
                  重试
                </button>
                <button
                  type="button"
                  aria-label="关闭错误提示"
                  onClick={() => onSendErrorChange(null)}
                >
                  关闭
                </button>
              </span>
            </div>
          )}
          {input}
        </>
      )}
    </CopilotChatView>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
