import { MessageSchema, type Message } from "@ag-ui/core";

export const WORKSPACE_VERSION = 1;
export const WORKSPACE_STORAGE_KEY = "weather-copilot-workspace-v1";

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  projectId: string | null;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceState = {
  version: typeof WORKSPACE_VERSION;
  projects: Project[];
  sessions: Session[];
  activeProjectId: string;
  activeSessionId: string;
};

export const DEFAULT_PROJECT_NAME = "天气助手";

export function createDefaultWorkspace(
  now: () => string = () => new Date().toISOString(),
  createId: () => string = () => crypto.randomUUID(),
): WorkspaceState {
  const timestamp = now();
  const projectId = createId();
  const sessionId = createId();

  return {
    version: WORKSPACE_VERSION,
    projects: [emptyProject(projectId, DEFAULT_PROJECT_NAME, timestamp)],
    sessions: [
      {
        id: sessionId,
        projectId,
        title: DEFAULT_SESSION_TITLE,
        messages: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    activeProjectId: projectId,
    activeSessionId: sessionId,
  };
}

export function serializeWorkspace(workspace: WorkspaceState): string {
  return JSON.stringify(workspace);
}

export function parseWorkspace(serialized: string): WorkspaceState {
  let value: unknown;

  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Invalid workspace state");
  }

  if (!isWorkspaceState(value)) {
    throw new Error("Invalid workspace state");
  }

  return value;
}

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem"> &
  Partial<Pick<Storage, "removeItem">>;

export type WorkspaceLoadOptions = {
  now?: () => string;
  createId?: () => string;
};

export type WorkspaceLoadResult = {
  workspace: WorkspaceState;
  recovered: boolean;
  error?: string;
};

export function loadWorkspace(
  storage: WorkspaceStorage,
  options: WorkspaceLoadOptions = {},
): WorkspaceLoadResult {
  let serialized: string | null;

  try {
    serialized = storage.getItem(WORKSPACE_STORAGE_KEY);
  } catch (error) {
    storage.removeItem?.(WORKSPACE_STORAGE_KEY);
    return {
      workspace: createDefaultWorkspace(options.now, options.createId),
      recovered: true,
      error: errorMessage(error),
    };
  }

  if (serialized === null) {
    return {
      workspace: createDefaultWorkspace(options.now, options.createId),
      recovered: false,
    };
  }

  try {
    return { workspace: parseWorkspace(serialized), recovered: false };
  } catch (error) {
    storage.removeItem?.(WORKSPACE_STORAGE_KEY);
    return {
      workspace: createDefaultWorkspace(options.now, options.createId),
      recovered: true,
      error: errorMessage(error),
    };
  }
}

export function saveWorkspace(
  storage: Pick<Storage, "setItem">,
  workspace: WorkspaceState,
): { saved: true } | { saved: false; error: string } {
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, serializeWorkspace(workspace));
    return { saved: true };
  } catch (error) {
    return { saved: false, error: errorMessage(error) };
  }
}

export const DEFAULT_SESSION_TITLE = "新会话";
export const SESSION_TITLE_MAX_LENGTH = 24;

export function deriveSessionTitle(content: string): string {
  return [...content.replace(/[\r\n]/g, "")].slice(0, SESSION_TITLE_MAX_LENGTH).join("");
}

export type SessionMessageSync = "restore-snapshot" | "save-snapshot" | "in-sync";

export function reconcileSessionMessages(
  agentMessages: Message[],
  sessionMessages: Message[],
): SessionMessageSync {
  if (JSON.stringify(agentMessages) === JSON.stringify(sessionMessages)) {
    return "in-sync";
  }

  return agentMessages.length === 0 ? "restore-snapshot" : "save-snapshot";
}

export type SessionChangeOptions = {
  now?: () => string;
  createId?: () => string;
};

function resolveNow(options: Pick<SessionChangeOptions, "now">): () => string {
  return options.now ?? (() => new Date().toISOString());
}

function resolveCreateId(
  options: Pick<SessionChangeOptions, "createId">,
): () => string {
  return options.createId ?? (() => crypto.randomUUID());
}

function emptyProject(id: string, name: string, timestamp: string): Project {
  return { id, name, createdAt: timestamp, updatedAt: timestamp };
}

function emptySession(
  id: string,
  projectId: string | null,
  timestamp: string,
): Session {
  return {
    id,
    projectId,
    title: DEFAULT_SESSION_TITLE,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createSession(
  workspace: WorkspaceState,
  options: SessionChangeOptions = {},
): WorkspaceState {
  const now = resolveNow(options);
  const createId = resolveCreateId(options);
  const timestamp = now();
  const session = emptySession(createId(), workspace.activeProjectId, timestamp);

  return {
    ...workspace,
    sessions: [...workspace.sessions, session],
    activeSessionId: session.id,
  };
}

export function setSessionMessages(
  workspace: WorkspaceState,
  sessionId: string,
  messages: Message[],
  options: Pick<SessionChangeOptions, "now"> = {},
): WorkspaceState {
  const now = resolveNow(options);
  const timestamp = now();
  const firstUserMessage = messages.find((message) => message.role === "user");

  return {
    ...workspace,
    sessions: workspace.sessions.map((session) => {
      if (session.id !== sessionId) return session;

      const derivedTitle = firstUserMessage
        ? deriveSessionTitle(messageText(firstUserMessage))
        : "";
      const title =
        session.title === DEFAULT_SESSION_TITLE && derivedTitle
          ? derivedTitle
          : session.title;

      return { ...session, title, messages, updatedAt: timestamp };
    }),
  };
}

export function renameSession(
  workspace: WorkspaceState,
  sessionId: string,
  title: string,
  options: Pick<SessionChangeOptions, "now"> = {},
): WorkspaceState {
  const now = resolveNow(options);
  const timestamp = now();

  return {
    ...workspace,
    sessions: workspace.sessions.map((session) =>
      session.id === sessionId
        ? { ...session, title, updatedAt: timestamp }
        : session,
    ),
  };
}

export function switchSession(
  workspace: WorkspaceState,
  sessionId: string,
): WorkspaceState {
  if (!workspace.sessions.some((session) => session.id === sessionId)) {
    return workspace;
  }

  return { ...workspace, activeSessionId: sessionId };
}

export function createProject(
  workspace: WorkspaceState,
  name: string,
  options: SessionChangeOptions = {},
): WorkspaceState {
  const now = resolveNow(options);
  const createId = resolveCreateId(options);
  const timestamp = now();
  const project = emptyProject(createId(), name, timestamp);
  const session = emptySession(createId(), project.id, timestamp);

  return {
    ...workspace,
    projects: [...workspace.projects, project],
    sessions: [...workspace.sessions, session],
    activeProjectId: project.id,
    activeSessionId: session.id,
  };
}

export function renameProject(
  workspace: WorkspaceState,
  projectId: string,
  name: string,
  options: Pick<SessionChangeOptions, "now"> = {},
): WorkspaceState {
  const now = resolveNow(options);
  const timestamp = now();

  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === projectId
        ? { ...project, name, updatedAt: timestamp }
        : project,
    ),
  };
}

export function deleteProject(
  workspace: WorkspaceState,
  projectId: string,
  options: SessionChangeOptions = {},
): WorkspaceState {
  if (!workspace.projects.some((project) => project.id === projectId)) {
    return workspace;
  }

  const projects = workspace.projects.filter((project) => project.id !== projectId);
  const sessions = workspace.sessions.map((session) =>
    session.projectId === projectId ? { ...session, projectId: null } : session,
  );

  if (workspace.activeProjectId !== projectId) {
    return { ...workspace, projects, sessions };
  }

  const fallback = projects[0];
  if (fallback) {
    return { ...workspace, projects, sessions, activeProjectId: fallback.id };
  }

  const now = resolveNow(options);
  const createId = resolveCreateId(options);
  const timestamp = now();
  const project = emptyProject(createId(), DEFAULT_PROJECT_NAME, timestamp);

  return {
    ...workspace,
    projects: [project],
    sessions,
    activeProjectId: project.id,
  };
}

export function switchProject(
  workspace: WorkspaceState,
  projectId: string,
): WorkspaceState {
  if (!workspace.projects.some((project) => project.id === projectId)) {
    return workspace;
  }

  return { ...workspace, activeProjectId: projectId };
}

export function deleteSession(
  workspace: WorkspaceState,
  sessionId: string,
  options: SessionChangeOptions = {},
): WorkspaceState {
  const target = workspace.sessions.find((session) => session.id === sessionId);
  if (!target) return workspace;

  const sessions = workspace.sessions.filter((session) => session.id !== sessionId);
  if (workspace.activeSessionId !== sessionId) {
    return { ...workspace, sessions };
  }

  const sibling = sessions
    .filter((session) => session.projectId === target.projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (sibling) {
    return { ...workspace, sessions, activeSessionId: sibling.id };
  }

  const now = resolveNow(options);
  const createId = resolveCreateId(options);
  const timestamp = now();
  const session = emptySession(createId(), target.projectId, timestamp);

  return {
    ...workspace,
    sessions: [...sessions, session],
    activeSessionId: session.id,
  };
}

function messageText(message: Message): string {
  return typeof message.content === "string" ? message.content : "";
}

export type HistoryScope =
  | { kind: "project"; projectId: string }
  | { kind: "unclassified" }
  | { kind: "all" };

export function filterSessionsByScope(
  sessions: Session[],
  scope: HistoryScope,
): Session[] {
  switch (scope.kind) {
    case "project":
      return sessions.filter((session) => session.projectId === scope.projectId);
    case "unclassified":
      return sessions.filter((session) => session.projectId === null);
    case "all":
      return sessions;
  }
}

export function getSessionHistory(workspace: WorkspaceState): Session[] {
  return workspace.sessions
    .filter((session) => session.messages.some((message) => message.role === "user"))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export type SessionHistoryGroups = {
  today: Session[];
  yesterday: Session[];
  earlier: Session[];
};

export function groupSessionHistory(
  workspace: WorkspaceState,
  now: () => string = () => new Date().toISOString(),
  scope: HistoryScope = { kind: "all" },
): SessionHistoryGroups {
  const current = new Date(now());
  const todayStart = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  );
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const groups: SessionHistoryGroups = { today: [], yesterday: [], earlier: [] };
  const visible = filterSessionsByScope(getSessionHistory(workspace), scope);
  for (const session of visible) {
    const updated = new Date(session.updatedAt);
    if (updated >= todayStart) {
      groups.today.push(session);
    } else if (updated >= yesterdayStart) {
      groups.yesterday.push(session);
    } else {
      groups.earlier.push(session);
    }
  }

  return groups;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown storage error";
}

function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object") return false;

  const workspace = value as Partial<WorkspaceState>;
  if (!Array.isArray(workspace.projects) || !Array.isArray(workspace.sessions)) {
    return false;
  }

  const projectIds = new Set(workspace.projects.map((project) => project.id));
  const sessionIds = new Set(workspace.sessions.map((session) => session.id));

  return (
    workspace.version === WORKSPACE_VERSION &&
    workspace.projects.length > 0 &&
    workspace.sessions.length > 0 &&
    typeof workspace.activeProjectId === "string" &&
    typeof workspace.activeSessionId === "string" &&
    projectIds.has(workspace.activeProjectId) &&
    sessionIds.has(workspace.activeSessionId) &&
    workspace.projects.every(isProject) &&
    workspace.sessions.every(
      (session) => isSession(session) &&
        (session.projectId === null || projectIds.has(session.projectId)),
    )
  );
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;

  const project = value as Partial<Project>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string"
  );
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;

  const session = value as Partial<Session>;
  return (
    typeof session.id === "string" &&
    (typeof session.projectId === "string" || session.projectId === null) &&
    typeof session.title === "string" &&
    Array.isArray(session.messages) &&
    session.messages.every((message) => MessageSchema.safeParse(message).success) &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string"
  );
}
