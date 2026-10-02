// 带指数退避的重试（仓库惯例：外部请求与模型调用都走这个模式）。

export async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
  }

  throw new Error(`${label} failed after 3 attempts: ${String(lastError)}`);
}
