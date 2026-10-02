import { weatherTool } from '../tools/weather-tool';
import { webOpenUrlTool } from '../tools/web-open-url-tool';
import { webOpenUrlRenderedTool } from '../tools/web-open-url-rendered-tool';

// 后端工具注册表：DSL 校验查 toolName、编辑器工具节点选项都以此为准。
// 新增工具在此登记一处即对两个消费方可见。

export interface ToolRegistryEntry {
  name: string;
  description: string;
}

const registeredTools = [weatherTool, webOpenUrlTool, webOpenUrlRenderedTool];

export function getToolRegistry(): ToolRegistryEntry[] {
  return registeredTools.map((tool) => ({ name: tool.id, description: tool.description }));
}

export function getToolNames(): string[] {
  return registeredTools.map((tool) => tool.id);
}

// 按注册表 id 取工具实例（编译工具节点用；toolName 合法性由 DSL 校验保证）
export function getToolByName(name: string) {
  return registeredTools.find((tool) => tool.id === name);
}
