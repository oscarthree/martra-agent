import { describe, expect, it } from "vitest";
import {
  createDefaultWorkspace,
  getSessionHistory,
  loadWorkspace,
  parseWorkspace,
  saveWorkspace,
  serializeWorkspace,
} from "./workspace-state";

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
      (() => {
        let nextId = 0;
        return () => `id-${++nextId}`;
      })(),
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
      (() => {
        let nextId = 0;
        return () => `id-${++nextId}`;
      })(),
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
