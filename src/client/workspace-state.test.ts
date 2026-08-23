import { describe, expect, it } from "vitest";
import {
  createDefaultWorkspace,
  createProject,
  createSession,
  deleteProject,
  deleteSession,
  deriveSessionTitle,
  filterSessionsByScope,
  getSessionHistory,
  groupSessionHistory,
  loadWorkspace,
  parseWorkspace,
  reconcileSessionMessages,
  renameProject,
  renameSession,
  runtimeAgentIdFor,
  saveWorkspace,
  serializeWorkspace,
  setSessionMessages,
  switchProject,
  switchSession,
  validateProjectName,
} from "./workspace-state";

function sequentialIds(prefix = "id") {
  let nextId = 0;
  return () => `${prefix}-${++nextId}`;
}

describe("Workspace state", () => {
  it("creates a default project and empty active session", () => {
    const workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z");

    expect(workspace.projects).toHaveLength(1);
    expect(workspace.projects[0]?.name).toBe("天气助手");
    expect(workspace.sessions).toHaveLength(1);
    expect(workspace.sessions[0]?.projectId).toBe(workspace.projects[0]?.id);
    expect(workspace.sessions[0]?.title).toBe("新会话");
    expect(workspace.sessions[0]?.messages).toEqual([]);
    expect(workspace.activeProjectId).toBe(workspace.projects[0]?.id);
    expect(workspace.activeSessionId).toBe(workspace.sessions[0]?.id);
  });

  it("round-trips the complete message snapshot", () => {
    const workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );
    workspace.sessions[0]!.messages = [
      { id: "message-1", role: "user", content: "大连明天天气怎么样？" },
    ];

    const restored = parseWorkspace(serializeWorkspace(workspace));

    expect(restored).toEqual(workspace);
  });

  it("rejects invalid workspace data", () => {
    expect(() => parseWorkspace("{\"version\":99}"))
      .toThrow("Invalid workspace state");
  });

  it("keeps empty sessions out of Session History", () => {
    const workspace = createDefaultWorkspace();

    expect(getSessionHistory(workspace)).toEqual([]);
  });

  it.each([
    {
      name: "missing active project",
      change: (workspace: ReturnType<typeof createDefaultWorkspace>) => {
        workspace.activeProjectId = "missing-project";
      },
    },
    {
      name: "missing session project",
      change: (workspace: ReturnType<typeof createDefaultWorkspace>) => {
        workspace.sessions[0]!.projectId = "missing-project";
      },
    },
    {
      name: "malformed message",
      change: (workspace: ReturnType<typeof createDefaultWorkspace>) => {
        workspace.sessions[0]!.messages = [{ id: "message-1" } as never];
      },
    },
  ])("rejects workspace with $name", ({ change }) => {
    const workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );
    change(workspace);

    expect(() => parseWorkspace(serializeWorkspace(workspace)))
      .toThrow("Invalid workspace state");
  });

  it("recovers a default workspace when storage is invalid", () => {
    let removedKey = "";
    const storage = {
      getItem: () => "not-json",
      setItem: () => undefined,
      removeItem: (key: string) => { removedKey = key; },
    };
    const result = loadWorkspace(storage, {
      now: () => "2026-08-11T00:00:00.000Z",
      createId: (() => {
        let nextId = 0;
        return () => `id-${++nextId}`;
      })(),
    });

    expect(result.recovered).toBe(true);
    expect(result.workspace.projects[0]?.name).toBe("天气助手");
    expect(result.error).toBe("Invalid workspace state");
    expect(removedKey).toBe("weather-copilot-workspace-v1");
  });

  it("recovers when storage cannot be read", () => {
    const result = loadWorkspace({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => undefined,
    });

    expect(result.recovered).toBe(true);
    expect(result.error).toBe("blocked");
  });

  it("keeps the workspace available when storage writing fails", () => {
    const workspace = createDefaultWorkspace();
    const result = saveWorkspace(
      { setItem: () => { throw new Error("quota"); } },
      workspace,
    );

    expect(result).toEqual({ saved: false, error: "quota" });
  });
});

describe("deriveSessionTitle", () => {
  it("takes the first 24 characters with newlines removed", () => {
    expect(deriveSessionTitle("第一行内容\r\n第二行内容\r\n第三行内容\n第四行内容\n第五行内容\n第六行内容"))
      .toBe("第一行内容第二行内容第三行内容第四行内容第五行内");
  });

  it("keeps short content as-is", () => {
    expect(deriveSessionTitle("北京天气")).toBe("北京天气");
  });

  it("counts characters, not UTF-16 units", () => {
    const content = "🌤️".repeat(30);
    expect([...deriveSessionTitle(content)]).toHaveLength(24);
  });
});

describe("createSession", () => {
  it("creates an empty session under the active project and activates it", () => {
    const workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );

    const next = createSession(workspace, {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: () => "session-2",
    });

    expect(next.sessions).toHaveLength(2);
    const created = next.sessions[1]!;
    expect(created.id).toBe("session-2");
    expect(created.projectId).toBe(workspace.activeProjectId);
    expect(created.title).toBe("新会话");
    expect(created.messages).toEqual([]);
    expect(created.createdAt).toBe("2026-08-12T00:00:00.000Z");
    expect(next.activeSessionId).toBe("session-2");
    expect(next.activeProjectId).toBe(workspace.activeProjectId);
    expect(workspace.sessions).toHaveLength(1);
  });
});

describe("setSessionMessages", () => {
  const base = () =>
    createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );

  it("saves the full message snapshot and bumps updatedAt", () => {
    const workspace = base();
    const messages = [
      { id: "m1", role: "user" as const, content: "上海今天天气" },
      { id: "m2", role: "assistant" as const, content: "上海今天晴，26°C。" },
    ];

    const next = setSessionMessages(workspace, workspace.activeSessionId, messages, {
      now: () => "2026-08-12T08:00:00.000Z",
    });

    const session = next.sessions[0]!;
    expect(session.messages).toEqual(messages);
    expect(session.updatedAt).toBe("2026-08-12T08:00:00.000Z");
    expect(session.createdAt).toBe("2026-08-11T00:00:00.000Z");
  });

  it("derives the title from the first user message while untitled", () => {
    const workspace = base();

    const next = setSessionMessages(
      workspace,
      workspace.activeSessionId,
      [{ id: "m1", role: "user" as const, content: "广州周末\n适合去哪儿玩？" }],
    );

    expect(next.sessions[0]!.title).toBe("广州周末适合去哪儿玩？");
  });

  it("does not override a manually renamed title", () => {
    const workspace = base();
    const renamed = renameSession(workspace, workspace.activeSessionId, "我的行程");

    const next = setSessionMessages(
      renamed,
      workspace.activeSessionId,
      [{ id: "m1", role: "user" as const, content: "北京天气如何" }],
    );

    expect(next.sessions[0]!.title).toBe("我的行程");
  });
});

describe("groupSessionHistory", () => {
  const localIso = (y: number, mo: number, d: number, h: number) =>
    new Date(y, mo - 1, d, h).toISOString();

  function workspaceWithSessions() {
    let nextId = 0;
    const createId = () => `session-${++nextId}`;
    let workspace = createDefaultWorkspace(() => localIso(2026, 8, 10, 10), createId);

    const withMessages = (
      ws: ReturnType<typeof createDefaultWorkspace>,
      sessionId: string,
      updatedAt: string,
    ) =>
      setSessionMessages(
        ws,
        sessionId,
        [{ id: `m-${sessionId}`, role: "user" as const, content: "天气" }],
        { now: () => updatedAt },
      );

    const earlierId = workspace.activeSessionId;
    workspace = withMessages(workspace, earlierId, localIso(2026, 8, 10, 10));
    workspace = createSession(workspace, { now: () => localIso(2026, 8, 13, 9), createId });
    const yesterdayId = workspace.activeSessionId;
    workspace = withMessages(workspace, yesterdayId, localIso(2026, 8, 13, 18));
    workspace = createSession(workspace, { now: () => localIso(2026, 8, 14, 8), createId });
    const todayOlderId = workspace.activeSessionId;
    workspace = withMessages(workspace, todayOlderId, localIso(2026, 8, 14, 8));
    workspace = createSession(workspace, { now: () => localIso(2026, 8, 14, 9), createId });
    const todayNewerId = workspace.activeSessionId;
    workspace = withMessages(workspace, todayNewerId, localIso(2026, 8, 14, 11));

    return { workspace, earlierId, yesterdayId, todayOlderId, todayNewerId };
  }

  it("groups sessions into today, yesterday and earlier", () => {
    const { workspace, earlierId, yesterdayId, todayOlderId, todayNewerId } =
      workspaceWithSessions();

    const groups = groupSessionHistory(workspace, () => localIso(2026, 8, 14, 12));

    expect(groups.today.map((s) => s.id)).toEqual([todayNewerId, todayOlderId]);
    expect(groups.yesterday.map((s) => s.id)).toEqual([yesterdayId]);
    expect(groups.earlier.map((s) => s.id)).toEqual([earlierId]);
  });

  it("keeps empty sessions out of every group", () => {
    const { workspace } = workspaceWithSessions();
    const next = createSession(workspace, {
      now: () => localIso(2026, 8, 14, 12),
      createId: () => "session-empty",
    });

    const groups = groupSessionHistory(next, () => localIso(2026, 8, 14, 12));

    expect(groups.today.map((s) => s.id)).not.toContain("session-empty");
  });
});

describe("switchSession", () => {
  it("activates the target session without changing its project", () => {
    let nextId = 0;
    const createId = () => `id-${++nextId}`;
    let workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", createId);
    const firstSessionId = workspace.activeSessionId;
    workspace = createSession(workspace, { now: () => "2026-08-12T00:00:00.000Z", createId });
    const secondSessionId = workspace.activeSessionId;

    const next = switchSession(workspace, firstSessionId);

    expect(next.activeSessionId).toBe(firstSessionId);
    expect(next.activeProjectId).toBe(workspace.activeProjectId);
    const projectId = workspace.activeProjectId;
    expect(next.sessions.find((s) => s.id === firstSessionId)?.projectId).toBe(projectId);
    expect(next.sessions.find((s) => s.id === secondSessionId)?.projectId).toBe(projectId);
  });

  it("ignores unknown session ids", () => {
    const workspace = createDefaultWorkspace();

    expect(switchSession(workspace, "missing")).toBe(workspace);
  });
});

describe("deleteSession", () => {
  const base = () => {
    let nextId = 0;
    const createId = () => `id-${++nextId}`;
    return {
      createId,
      workspace: createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", createId),
    };
  };

  it("opens the most recently updated sibling in the same project", () => {
    const { createId, workspace: initial } = base();
    const firstId = initial.activeSessionId;
    let workspace = createSession(initial, { now: () => "2026-08-12T00:00:00.000Z", createId });
    const secondId = workspace.activeSessionId;
    workspace = setSessionMessages(workspace, firstId, [
      { id: "m1", role: "user" as const, content: "天气" },
    ], { now: () => "2026-08-13T00:00:00.000Z" });

    const next = deleteSession(workspace, secondId);

    expect(next.sessions.map((s) => s.id)).toEqual([firstId]);
    expect(next.activeSessionId).toBe(firstId);
  });

  it("creates a new empty session when no sibling remains", () => {
    const { workspace } = base();
    const onlyId = workspace.activeSessionId;

    const next = deleteSession(workspace, onlyId, {
      now: () => "2026-08-14T00:00:00.000Z",
      createId: () => "fresh-session",
    });

    expect(next.sessions).toHaveLength(1);
    const created = next.sessions[0]!;
    expect(created.id).toBe("fresh-session");
    expect(created.projectId).toBe(workspace.activeProjectId);
    expect(created.messages).toEqual([]);
    expect(next.activeSessionId).toBe("fresh-session");
  });

  it("keeps the active session when deleting another one", () => {
    const { createId, workspace: initial } = base();
    const firstId = initial.activeSessionId;
    const workspace = createSession(initial, {
      now: () => "2026-08-12T00:00:00.000Z",
      createId,
    });

    const next = deleteSession(workspace, firstId);

    expect(next.sessions.map((s) => s.id)).toEqual([workspace.activeSessionId]);
    expect(next.activeSessionId).toBe(workspace.activeSessionId);
  });

  it("ignores unknown session ids", () => {
    const { workspace } = base();

    expect(deleteSession(workspace, "missing")).toBe(workspace);
  });
});

describe("reconcileSessionMessages", () => {
  const userMessage = { id: "m1", role: "user" as const, content: "天气" };

  it("restores the snapshot when the agent is empty and the session has messages", () => {
    expect(reconcileSessionMessages([], [userMessage])).toBe("restore-snapshot");
  });

  it("saves the snapshot when the agent has newer messages", () => {
    expect(reconcileSessionMessages([userMessage], [])).toBe("save-snapshot");
  });

  it("stays in sync when both sides hold the same messages", () => {
    expect(reconcileSessionMessages([userMessage], [userMessage])).toBe("in-sync");
  });

  it("stays in sync when both sides are empty", () => {
    expect(reconcileSessionMessages([], [])).toBe("in-sync");
  });
});

describe("createProject", () => {
  it("creates a project, activates it, and opens an empty session in it", () => {
    const workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", sequentialIds());
    const previousSessionId = workspace.activeSessionId;

    const next = createProject(workspace, "东京行程", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
    });

    expect(next.projects).toHaveLength(2);
    const project = next.projects[1]!;
    expect(project.id).toBe("p-1");
    expect(project.name).toBe("东京行程");
    expect(next.activeProjectId).toBe("p-1");

    const session = next.sessions.find((s) => s.id === next.activeSessionId)!;
    expect(session.id).toBe("p-2");
    expect(session.projectId).toBe("p-1");
    expect(session.messages).toEqual([]);
    expect(next.activeSessionId).not.toBe(previousSessionId);
  });
});

describe("switchProject", () => {
  it("changes only the active project, not session ownership or active session", () => {
    let workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", sequentialIds());
    workspace = createProject(workspace, "东京行程", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
    });
    const defaultProjectId = workspace.projects[0]!.id;
    const activeSessionId = workspace.activeSessionId;

    const next = switchProject(workspace, defaultProjectId);

    expect(next.activeProjectId).toBe(defaultProjectId);
    expect(next.activeSessionId).toBe(activeSessionId);
    expect(next.sessions).toEqual(workspace.sessions);
  });

  it("ignores unknown project ids", () => {
    const workspace = createDefaultWorkspace();

    expect(switchProject(workspace, "missing")).toBe(workspace);
  });
});

describe("renameProject", () => {
  it("renames the project and bumps updatedAt", () => {
    const workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", sequentialIds());
    const projectId = workspace.activeProjectId;

    const next = renameProject(workspace, projectId, "周末计划", {
      now: () => "2026-08-13T00:00:00.000Z",
    });

    expect(next.projects[0]!.name).toBe("周末计划");
    expect(next.projects[0]!.updatedAt).toBe("2026-08-13T00:00:00.000Z");
    expect(next.projects[0]!.createdAt).toBe("2026-08-11T00:00:00.000Z");
  });
});

describe("deleteProject", () => {
  const base = () => {
    let workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", sequentialIds());
    workspace = createProject(workspace, "东京行程", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
    });
    return workspace;
  };

  it("unclassifies its sessions, keeps the active session, selects the first remaining project", () => {
    const workspace = base();
    const tokyoId = workspace.activeProjectId; // 东京行程 is active
    const tokyoSessionId = workspace.activeSessionId;
    const defaultProjectId = workspace.projects[0]!.id;

    const next = deleteProject(workspace, tokyoId);

    expect(next.projects.map((p) => p.id)).toEqual([defaultProjectId]);
    const orphaned = next.sessions.find((s) => s.id === tokyoSessionId)!;
    expect(orphaned.projectId).toBeNull();
    expect(next.activeSessionId).toBe(tokyoSessionId);
    expect(next.activeProjectId).toBe(defaultProjectId);
  });

  it("recreates the default project when the last one is deleted", () => {
    const workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", sequentialIds());

    const next = deleteProject(workspace, workspace.activeProjectId, {
      now: () => "2026-08-14T00:00:00.000Z",
      createId: () => "fresh-project",
    });

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]!.id).toBe("fresh-project");
    expect(next.projects[0]!.name).toBe("天气助手");
    expect(next.activeProjectId).toBe("fresh-project");
    expect(next.sessions[0]!.projectId).toBeNull();
    expect(next.activeSessionId).toBe(workspace.activeSessionId);
  });

  it("keeps the active project when deleting another one", () => {
    const workspace = base();
    const defaultProjectId = workspace.projects[0]!.id;
    const tokyoId = workspace.activeProjectId;

    const next = deleteProject(workspace, defaultProjectId);

    expect(next.activeProjectId).toBe(tokyoId);
    expect(next.projects.map((p) => p.id)).toEqual([tokyoId]);
  });

  it("ignores unknown project ids", () => {
    const workspace = createDefaultWorkspace();

    expect(deleteProject(workspace, "missing")).toBe(workspace);
  });
});

describe("filterSessionsByScope", () => {
  const base = () => {
    let workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", sequentialIds());
    const defaultProjectId = workspace.activeProjectId;
    const defaultSessionId = workspace.activeSessionId;
    workspace = createProject(workspace, "东京行程", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
    });
    const tokyoProjectId = workspace.activeProjectId;
    const tokyoSessionId = workspace.activeSessionId;
    workspace = deleteProject(workspace, tokyoProjectId);
    // tokyoSession is now unclassified; defaultSession belongs to the default project
    return { workspace, defaultProjectId, defaultSessionId, tokyoSessionId };
  };

  it("keeps only the given project's sessions in project scope", () => {
    const { workspace, defaultProjectId, defaultSessionId } = base();

    const visible = filterSessionsByScope(workspace.sessions, {
      kind: "project",
      projectId: defaultProjectId,
    });

    expect(visible.map((s) => s.id)).toEqual([defaultSessionId]);
  });

  it("keeps only unclassified sessions in unclassified scope", () => {
    const { workspace, tokyoSessionId } = base();

    const visible = filterSessionsByScope(workspace.sessions, { kind: "unclassified" });

    expect(visible.map((s) => s.id)).toEqual([tokyoSessionId]);
  });

  it("keeps everything in all scope", () => {
    const { workspace } = base();

    expect(filterSessionsByScope(workspace.sessions, { kind: "all" }))
      .toHaveLength(workspace.sessions.length);
  });
});

describe("groupSessionHistory with scope", () => {
  it("groups only the sessions visible in the given scope", () => {
    let workspace = createDefaultWorkspace(() => "2026-08-11T00:00:00.000Z", sequentialIds());
    const defaultProjectId = workspace.activeProjectId;
    const defaultSessionId = workspace.activeSessionId;
    workspace = setSessionMessages(workspace, defaultSessionId, [
      { id: "m1", role: "user" as const, content: "天气" },
    ], { now: () => "2026-08-11T00:00:00.000Z" });
    workspace = createProject(workspace, "东京行程", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
    });
    const tokyoSessionId = workspace.activeSessionId;
    workspace = setSessionMessages(workspace, tokyoSessionId, [
      { id: "m2", role: "user" as const, content: "东京天气" },
    ], { now: () => "2026-08-12T00:00:00.000Z" });

    const groups = groupSessionHistory(
      workspace,
      () => "2026-08-14T00:00:00.000Z",
      { kind: "project", projectId: defaultProjectId },
    );

    expect(groups.earlier.map((s) => s.id)).toEqual([defaultSessionId]);
    expect(groups.today).toEqual([]);
  });
});

describe("validateProjectName", () => {
  it("rejects an empty name", () => {
    const workspace = createDefaultWorkspace();

    expect(validateProjectName(workspace, "   ")).toBe("请输入项目名称");
  });

  it("rejects a duplicate name", () => {
    const workspace = createDefaultWorkspace();

    expect(validateProjectName(workspace, "天气助手")).toBe("项目已存在");
  });

  it("accepts a new distinct name", () => {
    const workspace = createDefaultWorkspace();

    expect(validateProjectName(workspace, "东京行程")).toBeNull();
  });
});

describe("agentType binding", () => {
  it("marks the default project and session as weather", () => {
    const workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );

    expect(workspace.projects[0]?.agentType).toBe("weather");
    expect(workspace.sessions[0]?.agentType).toBe("weather");
  });

  it("captures the project type on the session created with the project", () => {
    let workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );
    workspace = createProject(workspace, "随便聊聊", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
      agentType: "general",
    });

    expect(workspace.projects[1]?.agentType).toBe("general");
    const session = workspace.sessions.find((s) => s.id === workspace.activeSessionId);
    expect(session?.projectId).toBe(workspace.projects[1]?.id);
    expect(session?.agentType).toBe("general");
  });

  it("captures the active project type on later new sessions", () => {
    let workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );
    workspace = createProject(workspace, "随便聊聊", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
      agentType: "general",
    });

    const next = createSession(workspace, {
      now: () => "2026-08-13T00:00:00.000Z",
      createId: () => "session-extra",
    });

    expect(
      next.sessions.find((s) => s.id === "session-extra")?.agentType,
    ).toBe("general");
  });

  it("defaults new projects to weather when no type is given", () => {
    const workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );

    const next = createProject(workspace, "东京行程", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
    });

    expect(next.projects[1]?.agentType).toBe("weather");
    expect(
      next.sessions.find((s) => s.id === next.activeSessionId)?.agentType,
    ).toBe("weather");
  });

  it("keeps the session agent type when its project is deleted", () => {
    let workspace = createDefaultWorkspace(
      () => "2026-08-11T00:00:00.000Z",
      sequentialIds(),
    );
    workspace = createProject(workspace, "随便聊聊", {
      now: () => "2026-08-12T00:00:00.000Z",
      createId: sequentialIds("p"),
      agentType: "general",
    });
    const sessionId = workspace.activeSessionId;

    const next = deleteProject(workspace, workspace.activeProjectId, {
      now: () => "2026-08-13T00:00:00.000Z",
      createId: () => "fresh-project",
    });

    const orphaned = next.sessions.find((s) => s.id === sessionId)!;
    expect(orphaned.projectId).toBeNull();
    expect(orphaned.agentType).toBe("general");
  });
});

describe("runtimeAgentIdFor", () => {
  it("maps each agent type to its Mastra registration key", () => {
    expect(runtimeAgentIdFor("weather")).toBe("weatherAgent");
    expect(runtimeAgentIdFor("general")).toBe("generalAgent");
  });
});

describe("workspace v1 migration", () => {
  function v1Payload() {
    return {
      version: 1,
      projects: [
        {
          id: "project-1",
          name: "天气助手",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      ],
      sessions: [
        {
          id: "session-1",
          projectId: "project-1",
          title: "东京三天行程",
          messages: [{ id: "m1", role: "user", content: "东京天气怎么样？" }],
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      ],
      activeProjectId: "project-1",
      activeSessionId: "session-1",
    };
  }

  it("upgrades v1 data in place, stamping the weather agent type", () => {
    const workspace = parseWorkspace(JSON.stringify(v1Payload()));

    expect(workspace.version).toBe(2);
    expect(workspace.projects[0]?.agentType).toBe("weather");
    expect(workspace.sessions[0]?.agentType).toBe("weather");
    expect(workspace.sessions[0]?.title).toBe("东京三天行程");
    expect(workspace.sessions[0]?.messages).toHaveLength(1);
    expect(workspace.activeProjectId).toBe("project-1");
    expect(workspace.activeSessionId).toBe("session-1");
  });

  it("migrates v1 data from storage without recovery", () => {
    const result = loadWorkspace({
      getItem: () => JSON.stringify(v1Payload()),
      setItem: () => undefined,
    });

    expect(result.recovered).toBe(false);
    expect(result.workspace.version).toBe(2);
    expect(result.workspace.projects[0]?.agentType).toBe("weather");
  });

  it("rejects data with an unknown agent type", () => {
    const workspace = parseWorkspace(JSON.stringify(v1Payload()));
    const tampered = {
      ...workspace,
      projects: [{ ...workspace.projects[0]!, agentType: "chat" }],
    };

    expect(() => parseWorkspace(JSON.stringify(tampered)))
      .toThrow("Invalid workspace state");
  });

  it("still rejects unknown versions", () => {
    expect(() => parseWorkspace(JSON.stringify({ version: 3 })))
      .toThrow("Invalid workspace state");
  });
});
