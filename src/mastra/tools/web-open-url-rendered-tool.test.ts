import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 用 vi.mock 替代真实浏览器，单测不启动 Chromium
const launchMock = vi.fn();
vi.mock('playwright', () => ({
  chromium: { launch: (...args: unknown[]) => launchMock(...args) },
}));

type FakePage = {
  goto: ReturnType<typeof vi.fn>;
  waitForLoadState: ReturnType<typeof vi.fn>;
  waitForURL: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
};

function fakeBrowser(page: Partial<FakePage>) {
  const closeMock = vi.fn(async () => {});
  const context = {
    newPage: vi.fn(async () => ({
      goto: vi.fn(async () => ({ status: () => 200 })),
      waitForLoadState: vi.fn(async () => {}),
      waitForURL: vi.fn(async () => {}),
      content: vi.fn(async () => '<html><body>渲染后</body></html>'),
      title: vi.fn(async () => '标题'),
      url: vi.fn(() => 'https://example.com/final'),
      ...page,
    })),
    close: closeMock,
  };
  launchMock.mockResolvedValue({ newContext: vi.fn(async () => context) });
  return { context, closeMock };
}

async function loadTool() {
  const module = await import('./web-open-url-rendered-tool');
  return module.webOpenUrlRenderedTool;
}

async function execute(tool: Awaited<ReturnType<typeof loadTool>>, url: string) {
  const result = await tool.execute!({ url }, {} as never);
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('unexpected tool result shape');
  }
  return result;
}

beforeEach(() => {
  vi.resetModules();
  launchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webOpenUrlRenderedTool', () => {
  it('returns the rendered HTML with final URL, status and title', async () => {
    fakeBrowser({});
    const tool = await loadTool();

    const result = await execute(tool, 'https://example.com/page');

    expect(result).toMatchObject({
      ok: true,
      url: 'https://example.com/page',
      finalUrl: 'https://example.com/final',
      status: 200,
      title: '标题',
      html: '<html><body>渲染后</body></html>',
      truncated: false,
    });
  });

  it('waits for network idle so JS challenge pages can settle', async () => {
    const { context } = fakeBrowser({});
    const tool = await loadTool();

    await execute(tool, 'https://example.com/challenge');

    const page = (await context.newPage.mock.results[0]?.value) as FakePage;
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', {
      timeout: expect.any(Number),
    });
  });

  it('reuses one browser across calls (new context per call)', async () => {
    fakeBrowser({});
    const tool = await loadTool();

    await execute(tool, 'https://example.com/a');
    await execute(tool, 'https://example.com/b');

    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('reports navigation timeout and still closes the context', async () => {
    const { closeMock } = fakeBrowser({
      goto: vi.fn(async () => {
        throw new DOMException('Timeout exceeded', 'TimeoutError');
      }),
    });
    const tool = await loadTool();

    const result = await execute(tool, 'https://example.com/slow');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('超时');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('reports generic navigation failure', async () => {
    fakeBrowser({
      goto: vi.fn(async () => {
        throw new Error('net::ERR_NAME_NOT_RESOLVED');
      }),
    });
    const tool = await loadTool();

    const result = await execute(tool, 'https://nonexistent.invalid/');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ERR_NAME_NOT_RESOLVED');
  });

  it('truncates very long rendered HTML', async () => {
    fakeBrowser({ content: vi.fn(async () => 'x'.repeat(60_000)) });
    const tool = await loadTool();

    const result = await execute(tool, 'https://example.com/long');

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.html).toHaveLength(50_000);
  });

  it('waits out an anti-bot challenge page and returns the real content', async () => {
    let currentUrl = 'https://sec.douban.com/c?r=target';
    const bodies = [
      '<html><body>安全检查 loading</body></html>',
      '<html><body>真实正文</body></html>',
    ];
    fakeBrowser({
      url: vi.fn(() => currentUrl),
      content: vi.fn(async () => bodies.shift() ?? '<html><body>真实正文</body></html>'),
      // 挑战页 JS 跳回目标页
      waitForURL: vi.fn(async () => {
        currentUrl = 'https://movie.douban.com/subject/1/';
      }),
    });
    const tool = await loadTool();

    const result = await execute(tool, 'https://movie.douban.com/subject/1/');

    expect(result).toMatchObject({
      ok: true,
      finalUrl: 'https://movie.douban.com/subject/1/',
    });
    if (result.ok) expect(result.html).toContain('真实正文');
  });

  it('fails with a clear error when stuck on the challenge page', async () => {
    fakeBrowser({
      url: vi.fn(() => 'https://sec.douban.com/c?r=target'),
      content: vi.fn(async () => '<html><body>安全检查 loading</body></html>'),
    });
    const tool = await loadTool();

    const result = await execute(tool, 'https://movie.douban.com/subject/1/');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('反爬校验未通过');
  });
});
