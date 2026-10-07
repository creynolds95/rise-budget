import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, REFRESH_LOCK, api, downloadExport, refreshSession, setAccess } from './api';

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  setAccess(null);
});

const respond = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe('api()', () => {
  it('turns a non-JSON error page into an ApiError, not a SyntaxError', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(respond(502, '<html><body>Bad gateway</body></html>'));
    const err = await api('GET', '/accounts').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('turns a non-JSON success body into an ApiError too', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(respond(200, '<!doctype html><title>app</title>'));
    await expect(api('GET', '/accounts')).rejects.toBeInstanceOf(ApiError);
  });

  it('still reads the API error contract', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      respond(409, JSON.stringify({ error: { code: 'CONFLICT', message: 'Already linked' } })),
    );
    await expect(api('GET', '/accounts')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Already linked',
    });
  });
});

describe('refreshSession()', () => {
  it('takes the cross-tab lock around the refresh, so tabs take turns', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(respond(200, JSON.stringify({ access: 'a1' })));
    const names: string[] = [];
    let held = false;
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: async (name: string, fn: () => Promise<unknown>) => {
          names.push(name);
          held = true;
          try {
            return await fn();
          } finally {
            held = false;
          }
        },
      },
    });
    fetchMock.mockImplementation(() => {
      expect(held).toBe(true);
      return Promise.resolve(respond(200, JSON.stringify({ access: 'a1' })));
    });
    expect(await refreshSession()).toBe('ok');
    expect(names).toEqual([REFRESH_LOCK]);
  });

  it('works where Web Locks are missing', async () => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { ...navigator, locks: undefined });
    fetchMock.mockResolvedValue(respond(200, JSON.stringify({ access: 'a1' })));
    expect(await refreshSession()).toBe('ok');
  });

  it('shares one attempt between callers in the same tab', async () => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { ...navigator, locks: undefined });
    fetchMock.mockResolvedValue(respond(200, JSON.stringify({ access: 'a1' })));
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('downloadExport()', () => {
  it('sends the passkey step-up with the backup download', async () => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
    fetchMock.mockResolvedValue(
      respond(200, 'gz', {
        'content-disposition': 'attachment; filename="rise-backup-2026-09-24.sql.gz"',
      }),
    );
    await downloadExport('backup', { stepUp: 'step-up-token' });
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/export/backups/latest');
    expect((init?.headers as Record<string, string>)['x-step-up']).toBe('step-up-token');
  });
});
