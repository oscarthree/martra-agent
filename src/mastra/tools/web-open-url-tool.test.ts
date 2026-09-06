import { afterEach, describe, expect, it, vi } from 'vitest';
import { webOpenUrlTool } from './web-open-url-tool';

const realFetch = globalThis.fetch;

function mockFetch(handler: (input: unknown, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(handler) as unknown as typeof fetch;
}

function htmlResponse(body: string, init: { status?: number; url?: string; contentType?: string } = {}) {
  const contentType = init.contentType ?? 'text/html; charset=utf-8';
  const response = new Response(body, { status: init.status ?? 200 });
  // Response 构造器会自动补 text/plain，传空串时手动删掉以模拟无 content-type 响应
  if (contentType) {
    response.headers.set('content-type', contentType);
  } else {
    response.headers.delete('content-type');
  }
  return response;
}

async function execute(url: string) {
  const result = await webOpenUrlTool.execute!({ url }, {} as never);
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('unexpected tool result shape');
  }
  return result;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('webOpenUrlTool', () => {
  it('returns the raw HTML on success', async () => {
    mockFetch(async () => htmlResponse('<html><body>你好</body></html>'));

    const result = await execute('https://example.com/page');

    expect(result).toMatchObject({
      ok: true,
      url: 'https://example.com/page',
      status: 200,
      html: '<html><body>你好</body></html>',
      truncated: false,
    });
  });

  it('reports the final URL after following redirects', async () => {
    mockFetch(async () => {
      const response = htmlResponse('<html></html>');
      // fetch 跟随重定向后 response.url 是最终地址；这里模拟该行为
      Object.defineProperty(response, 'url', {
        value: 'https://example.com/final',
      });
      return response;
    });

    const result = await execute('https://example.com/redirect');

    expect(result).toMatchObject({ ok: true, finalUrl: 'https://example.com/final' });
  });

  it('sends a browser-like User-Agent and requests HTML', async () => {
    let seenInit: RequestInit | undefined;
    mockFetch(async (_input, init) => {
      seenInit = init;
      return htmlResponse('<html></html>');
    });

    await execute('https://example.com/');

    const headers = seenInit?.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('Mozilla/5.0');
    expect(headers.Accept).toContain('text/html');
  });

  it('fails gracefully on timeout after retries', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });

    const result = await execute('https://example.com/slow');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('超时');
  }, 20_000);

  it('rejects non-HTML content types', async () => {
    mockFetch(async () =>
      htmlResponse('%PDF-1.4', { contentType: 'application/pdf' }),
    );

    const result = await execute('https://example.com/file.pdf');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('application/pdf');
  });

  it('explains 403 as a blocked non-browser request without retrying', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('Forbidden', { status: 403 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await execute('https://example.com/protected');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('403');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and reports the failure', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('oops', { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await execute('https://example.com/down');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('503');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('truncates very long HTML', async () => {
    mockFetch(async () => htmlResponse('x'.repeat(60_000)));

    const result = await execute('https://example.com/long');

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.html).toHaveLength(50_000);
  });

  it('accepts HTML responses with a missing content-type header', async () => {
    mockFetch(async () => htmlResponse('<html><body>无头信息</body></html>', { contentType: '' }));

    const result = await execute('https://example.com/no-content-type');

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.html).toContain('无头信息');
  });

  it('reports anti-bot challenge pages instead of a misleading content-type error', async () => {
    mockFetch(async () => {
      const response = htmlResponse('<html><body>安全检查 loading</body></html>', {
        contentType: '',
      });
      Object.defineProperty(response, 'url', {
        value: 'https://sec.douban.com/c?r=target',
      });
      return response;
    });

    const result = await execute('https://movie.douban.com/subject/1/');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('反爬安全验证页');
      expect(result.error).toContain('webOpenUrlRendered');
    }
  });
});
