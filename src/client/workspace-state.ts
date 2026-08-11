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

export function createDefaultWorkspace(
  now: () => string = () => new Date().toISOString(),
  createId: () => string = () => crypto.randomUUID(),
): WorkspaceState {
  const timestamp = now();
  const projectId = createId();
  const sessionId = createId();

  return {
    version: WORKSPACE_VERSION,
    projects: [
      {
        id: projectId,
        name: "天气助手",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    sessions: [
      {
        id: sessionId,
        projectId,
        title: "新会话",
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

export function getSessionHistory(workspace: WorkspaceState): Session[] {
  return workspace.sessions
    .filter((session) => session.messages.some((message) => message.role === "user"))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
