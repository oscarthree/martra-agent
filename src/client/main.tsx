import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CopilotChatAttachmentQueue,
  CopilotChatView,
  CopilotKit,
  UseAgentUpdate,
  useAgent,
  useAttachments,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import { Menu as MenuIcon, Plus } from "lucide-react";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";
import { AgentManagerView } from "./agent-manager";
import { currentResourceId, CustomAgentApiError, getCustomAgent } from "./custom-agent-api";
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
  runtimeAgentIdFor,
  saveWorkspace,
  setSessionMessages,
  switchProject,
  switchSession,
  validateProjectName,
  type AgentType,
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

const resourceId = currentResourceId();

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
  const [view, setView] = useState<"chat" | "agents">("chat");
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

  const handleCreateProject = (name: string, agentType: AgentType, customAgentId?: string) => {
    // 预生成 id：StrictMode 会重复执行 updater，id 必须保持确定
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    let call = 0;
    setWorkspace((current) =>
      createProject(current, name, {
        createId: () => ids[call++ % 2]!,
        agentType,
        customAgentId,
      }),
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
      onOpenAgentManager={() => {
        setView("agents");
        closeDrawer();
      }}
      agentManagerActive={view === "agents"}
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
            {view === "agents" ? (
              <AgentManagerView
                workspace={workspace}
                onExit={() => setView("chat")}
              />
            ) : (
              <WorkspaceChat
                session={activeSession}
                onMessagesChange={handleMessagesChange}
                sendError={chatError}
                onSendErrorChange={setChatError}
              />
            )}
          </section>
        </div>
        {drawerOpen && <Drawer onClose={closeDrawer}>{sidebar}</Drawer>}
      </main>

      {dialog?.kind === "project-create" && (
        <ProjectFormDialog
          mode="create"
          validate={(name) => validateProjectName(workspace, name)}
          onSubmit={handleCreateProject}
          onOpenAgentManager={() => {
            setDialog(null);
            setView("agents");
          }}
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

type WelcomeContent = {
  kicker: string;
  title: string;
  copy: string;
  suggestions: Array<{ label: string; prompt: string }>;
};

// 空状态文案按会话的 agent 类型区分：天气项目保留天气推荐问题，
// 通用助手项目显示通用欢迎语、不含天气推荐。
const WELCOME_CONTENT: Record<AgentType, WelcomeContent> = {
  weather: {
    kicker: "LIVE WEATHER ASSISTANT",
    title: "今天想去哪里？",
    copy: "告诉我一个城市、天气问题，或者你的下一段旅程。我会结合实时天气，帮你把一天安排得更从容。",
    suggestions: [
      { label: "北京周末天气", prompt: "北京周末天气怎么样？" },
      { label: "大连三天行程", prompt: "帮我安排大连三天行程" },
      { label: "东京出行建议", prompt: "东京今天适合带什么？" },
    ],
  },
  general: {
    kicker: "GENERAL ASSISTANT",
    title: "有什么可以帮你？",
    copy: "日常问答、闲聊、写作、翻译都可以。直接输入你的问题，我们开始。",
    suggestions: [],
  },
  custom: {
    kicker: "CUSTOM AGENT",
    title: "开始对话",
    copy: "该助手由自定义 Agent 定义驱动，会按编排好的工作流处理你的消息。",
    suggestions: [],
  },
};

// 附件只接受图片；useAttachments 配置与隐藏 file input 共用同一来源。
const ATTACHMENT_ACCEPT = "image/*";

function Welcome({
  content,
  onPick,
}: {
  content: WelcomeContent;
  onPick: (text: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-kicker">{content.kicker}</div>
      <h1>{content.title}</h1>
      <p className="welcome-copy">{content.copy}</p>
      {content.suggestions.length > 0 && (
        <div className="suggestions" aria-label="推荐问题">
          {content.suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              className="suggestion"
              onClick={() => onPick(suggestion.prompt)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
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
  // custom 会话先过定义门禁：绑定缺失或定义被删除时显示错误态、不挂 useAgent
  if (session.agentType === "custom") {
    return (
      <CustomAgentGate
        session={session}
        onMessagesChange={onMessagesChange}
        sendError={sendError}
        onSendErrorChange={onSendErrorChange}
      />
    );
  }
  // 非 custom 不可能是 null：真出现说明状态模型被破坏，宁可抛错也不静默降级
  const runtimeAgentId = runtimeAgentIdFor(session);
  if (runtimeAgentId === null) {
    throw new Error("非 custom 会话缺少 runtimeAgentId");
  }
  return (
    <ChatView
      session={session}
      runtimeAgentId={runtimeAgentId}
      onMessagesChange={onMessagesChange}
      sendError={sendError}
      onSendErrorChange={onSendErrorChange}
    />
  );
}

// custom 会话门禁：按捕获的定义 id 拉取定义。404（已删除）或绑定缺失 → 错误态且输入禁用；
// 定义更新即生效（会话只存 id，每次进入重新校验）。
function CustomAgentGate({
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
  const definitionId = session.customAgentId;
  const [gate, setGate] = useState<
    | { kind: "loading" }
    | { kind: "ready" }
    | { kind: "deleted" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    if (!definitionId) {
      setGate({ kind: "deleted" });
      return;
    }
    let cancelled = false;
    setGate({ kind: "loading" });
    getCustomAgent(definitionId)
      .then(() => {
        if (!cancelled) setGate({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof CustomAgentApiError && error.status === 404) {
          setGate({ kind: "deleted" });
        } else {
          setGate({
            kind: "error",
            message: error instanceof Error ? error.message : "加载失败",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [definitionId]);

  if (gate.kind === "loading") {
    return <div className="session-gate">正在加载自定义 Agent…</div>;
  }
  if (gate.kind === "deleted") {
    return (
      <div className="session-gate" role="alert">
        <div className="session-gate-title">该自定义 Agent 已被删除</div>
        <p className="session-gate-body">
          此会话无法再发送消息。可以在侧栏把会话移到其他项目，或留在未分类。
        </p>
      </div>
    );
  }
  if (gate.kind === "error") {
    return (
      <div className="session-gate" role="alert">
        <div className="session-gate-title">自定义 Agent 加载失败</div>
        <p className="session-gate-body">{gate.message}</p>
      </div>
    );
  }
  // 绑定缺失与已删除同走错误态；正常命中时路由键与推导函数同一来源
  const runtimeAgentId = runtimeAgentIdFor(session);
  if (runtimeAgentId === null) {
    return (
      <div className="session-gate" role="alert">
        <div className="session-gate-title">该自定义 Agent 已被删除</div>
        <p className="session-gate-body">
          此会话无法再发送消息。可以在侧栏把会话移到其他项目，或留在未分类。
        </p>
      </div>
    );
  }
  return (
    <ChatView
      session={session}
      runtimeAgentId={runtimeAgentId}
      onMessagesChange={onMessagesChange}
      sendError={sendError}
      onSendErrorChange={onSendErrorChange}
    />
  );
}

function ChatView({
  session,
  runtimeAgentId,
  onMessagesChange,
  sendError,
  onSendErrorChange,
}: {
  session: Session;
  runtimeAgentId: string;
  onMessagesChange: (messages: Message[]) => void;
  sendError: string | null;
  onSendErrorChange: (error: string | null) => void;
}) {
  const { agent } = useAgent({
    agentId: `workspace-session-${session.id}`,
    runtimeAgentId,
    threadId: session.id,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();
  const [inputValue, setInputValue] = useState("");

  // 附件仅对通用助手会话开放；天气会话没有任何附件入口。
  // 受控 CopilotChatView 的 children 分支不会自动渲染附件队列，
  // 需要手动组合队列、隐藏 file input 和拖拽/粘贴 handler。
  const attachmentsEnabled = session.agentType === "general";
  const {
    attachments,
    dragOver,
    fileInputRef,
    containerRef,
    handleFileUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    consumeAttachments,
  } = useAttachments({
    config: {
      enabled: attachmentsEnabled,
      accept: ATTACHMENT_ACCEPT,
      onUploadFailed: ({ message }) =>
        onSendErrorChange(`图片上传失败：${message}`),
    },
  });

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
      onAddFile={
        attachmentsEnabled ? () => fileInputRef.current?.click() : undefined
      }
      onSubmitMessage={async (text) => {
        // 附件仍在上传时拒绝发送，与 CopilotChat 内部 guard 一致；
        // 输入文本和附件都保留，用户可在上传完成后重发
        if (attachments.some((attachment) => attachment.status === "uploading")) {
          return;
        }
        const readyAttachments = attachmentsEnabled ? consumeAttachments() : [];
        if (readyAttachments.length === 0) {
          agent.addMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: text,
          });
        } else {
          agent.addMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: [
              ...(text.trim() ? [{ type: "text" as const, text }] : []),
              ...readyAttachments.map((attachment) => ({
                type: attachment.type,
                source: attachment.source,
                ...(attachment.filename
                  ? { metadata: { filename: attachment.filename } }
                  : {}),
              })),
            ],
          });
        }
        setInputValue("");
        await runAgent();
      }}
    >
      {({ scrollView, input }) => (
        <div
          ref={containerRef}
          className="chat-body"
          onDragOver={attachmentsEnabled ? handleDragOver : undefined}
          onDragLeave={attachmentsEnabled ? handleDragLeave : undefined}
          onDrop={attachmentsEnabled ? handleDrop : undefined}
        >
          <div className="chat-scroll">
            {agent.messages.length === 0 ? (
              <Welcome
                content={WELCOME_CONTENT[session.agentType]}
                onPick={setInputValue}
              />
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
          {attachmentsEnabled && (
            <CopilotChatAttachmentQueue
              attachments={attachments}
              onRemoveAttachment={removeAttachment}
            />
          )}
          {input}
          {attachmentsEnabled && (
            <input
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              hidden
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
          )}
          {attachmentsEnabled && dragOver && (
            <div className="drop-overlay">松开以上传图片</div>
          )}
        </div>
      )}
    </CopilotChatView>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
