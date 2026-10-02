// 自定义 Agent 定义的前端 REST 客户端：直连 /api/custom-agents（不经 CopilotKit），
// 自动携带 x-mastra-resource-id 头。列表带内存缓存，进入管理区 / 新建项目弹窗时
// 以 force 刷新；写操作不维护缓存，由调用方按需刷新。

export const RESOURCE_ID_STORAGE_KEY = "mastra-resource-id";

export function currentResourceId(): string {
  const existing = localStorage.getItem(RESOURCE_ID_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(RESOURCE_ID_STORAGE_KEY, created);
  return created;
}

export type CustomAgentSummary = {
  id: string;
  name: string;
  updatedAt: number;
};

export type ToolRegistryEntry = {
  name: string;
  description: string;
};

export type CustomAgentDetail = {
  id: string;
  name: string;
  resourceId: string;
  graph: unknown;
  createdAt: number;
  updatedAt: number;
};

export class CustomAgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CustomAgentApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path === "/" ? "/api/custom-agents" : `/api/custom-agents${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "x-mastra-resource-id": currentResourceId(),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CustomAgentApiError(
      extractErrorMessage(body) ?? `请求失败（HTTP ${response.status}）`,
      response.status,
    );
  }
  return body as T;
}

// 服务端错误统一为 { errors: [{ code, message, nodeId? }] }；取全部 message 拼成一句给用户。
function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  const messages = errors
    .map((error) =>
      error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : null,
    )
    .filter((message): message is string => message !== null);
  return messages.length > 0 ? messages.join("；") : null;
}

// 缓存按 resource-id 隔离：同浏览器切换身份（如清空 mastra-resource-id）后
// 旧缓存自动作废，不会把别的身份列表泄漏给新身份。
let summaryCache: { resourceId: string; summaries: CustomAgentSummary[] } | null = null;

export async function listCustomAgentSummaries(
  options: { force?: boolean } = {},
): Promise<CustomAgentSummary[]> {
  const resourceId = currentResourceId();
  if (summaryCache !== null && summaryCache.resourceId === resourceId && !options.force) {
    return summaryCache.summaries;
  }
  const summaries = await request<CustomAgentSummary[]>("/");
  summaryCache = { resourceId, summaries };
  return summaries;
}

export function clearCustomAgentCacheForTests(): void {
  summaryCache = null;
}

export function getCustomAgent(id: string): Promise<CustomAgentDetail> {
  return request(`/${id}`);
}

export function createCustomAgent(name: string): Promise<CustomAgentDetail> {
  return request("/", { method: "POST", body: JSON.stringify({ name }) });
}

export function updateCustomAgent(
  id: string,
  input: { name?: string; graph?: unknown },
): Promise<CustomAgentDetail> {
  return request(`/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

// PUT 按规格要求 graph 必填：改名 = 取回完整定义后带图回写。
export async function renameCustomAgent(id: string, name: string): Promise<CustomAgentDetail> {
  const detail = await getCustomAgent(id);
  return updateCustomAgent(id, { name, graph: detail.graph });
}

export async function deleteCustomAgent(id: string): Promise<void> {
  await request(`/${id}`, { method: "DELETE" });
}

export function getToolRegistry(): Promise<ToolRegistryEntry[]> {
  return request<ToolRegistryEntry[]>("/tools");
}
