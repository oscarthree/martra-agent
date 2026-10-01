import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomAgentApiError,
  clearCustomAgentCacheForTests,
  createCustomAgent,
  currentResourceId,
  deleteCustomAgent,
  listCustomAgentSummaries,
  renameCustomAgent,
} from "./custom-agent-api";

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  });
  return calls;
}

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  clearCustomAgentCacheForTests();
});

describe("currentResourceId", () => {
  it("returns the persisted resource id when present", () => {
    stubLocalStorage({ "mastra-resource-id": "res-1" });
    expect(currentResourceId()).toBe("res-1");
  });

  it("creates and persists a new resource id when absent", () => {
    const store = stubLocalStorage();
    const created = currentResourceId();
    expect(created).not.toBe("");
    expect(store.get("mastra-resource-id")).toBe(created);
  });
});

describe("listCustomAgentSummaries", () => {
  it("fetches summaries with the resource-id header and caches them", async () => {
    stubLocalStorage({ "mastra-resource-id": "res-1" });
    const calls = stubFetch(() => jsonOk([{ id: "a1", name: "助手", updatedAt: 1 }]));

    const first = await listCustomAgentSummaries();
    expect(first).toEqual([{ id: "a1", name: "助手", updatedAt: 1 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/custom-agents");
    expect(calls[0]?.init?.headers).toMatchObject({ "x-mastra-resource-id": "res-1" });

    await listCustomAgentSummaries();
    expect(calls).toHaveLength(1);

    await listCustomAgentSummaries({ force: true });
    expect(calls).toHaveLength(2);
  });

  it("invalidates the cache when the resource id changes", async () => {
    const store = stubLocalStorage({ "mastra-resource-id": "res-1" });
    const calls = stubFetch(() => jsonOk([]));
    await listCustomAgentSummaries();
    store.set("mastra-resource-id", "res-2");
    await listCustomAgentSummaries();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init?.headers).toMatchObject({ "x-mastra-resource-id": "res-2" });
  });

  it("throws a CustomAgentApiError with the server error message on failure", async () => {
    stubLocalStorage();
    stubFetch(
      () =>
        new Response(JSON.stringify({ errors: [{ code: "missing_start", message: "图中必须有一个开始节点" }] }), {
          status: 400,
        }),
    );
    const error = await listCustomAgentSummaries().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CustomAgentApiError);
    expect((error as CustomAgentApiError).message).toBe("图中必须有一个开始节点");
    expect((error as CustomAgentApiError).status).toBe(400);
  });

  it("falls back to a generic message when the error body has no error list", async () => {
    stubLocalStorage();
    stubFetch(() => new Response("boom", { status: 500 }));
    const error = await listCustomAgentSummaries().catch((e: unknown) => e);
    expect((error as Error).message).toContain("500");
  });
});

describe("createCustomAgent", () => {
  it("posts the name as JSON", async () => {
    stubLocalStorage({ "mastra-resource-id": "res-1" });
    const calls = stubFetch(() =>
      jsonOk({ id: "a1", name: "新助手", resourceId: "res-1", graph: {}, createdAt: 1, updatedAt: 1 }),
    );
    await createCustomAgent("新助手");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "新助手" }));
  });
});

describe("renameCustomAgent", () => {
  it("fetches the definition and puts it back with the new name", async () => {
    stubLocalStorage();
    const calls = stubFetch((url, init) => {
      if (init?.method === "PUT") return jsonOk({});
      expect(url).toBe("/api/custom-agents/a1");
      return jsonOk({ id: "a1", name: "旧", graph: { version: 1 }, updatedAt: 1 });
    });
    await renameCustomAgent("a1", "新");
    const put = calls.find((call) => call.init?.method === "PUT");
    expect(put?.url).toBe("/api/custom-agents/a1");
    expect(put?.init?.body).toBe(JSON.stringify({ name: "新", graph: { version: 1 } }));
  });
});

describe("deleteCustomAgent", () => {
  it("deletes and throws on 404", async () => {
    stubLocalStorage();
    let deleted = false;
    const calls = stubFetch(() => (deleted ? new Response("null", { status: 404 }) : ((deleted = true), jsonOk({ deleted: true }))));
    await deleteCustomAgent("a1");
    expect(calls[0]?.init?.method).toBe("DELETE");
    await expect(deleteCustomAgent("a1")).rejects.toBeInstanceOf(CustomAgentApiError);
  });
});
