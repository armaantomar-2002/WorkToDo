import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, fieldErrorsOf, getAccessToken, refreshSession, setAccessToken, setAuthLostHandler } from './api';

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); setAccessToken(null); setAuthLostHandler(null); });
afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends credentials, the CSRF header and the bearer token', async () => {
    setAccessToken('tok'); fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await api.get('/tasks', { page: 2, status: ['Pending', 'In Progress'], search: '' });
    const [url, init] = fetchMock.mock.calls[0]; expect(url).toBe('/api/v1/tasks?page=2&status=Pending%2CIn+Progress');
    expect(init.credentials).toBe('include'); expect(init.headers['X-Requested-With']).toBe('WorkToDo'); expect(init.headers.Authorization).toBe('Bearer tok');
  });
  it('turns error envelopes into ApiError with field errors', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { error: 'validation_error', message: 'Request validation failed', errors: [{ field: 'email', message: 'bad' }, { field: 'email', message: 'second' }] }));
    const err = (await api.post('/x', {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError); expect(err.status).toBe(422); expect(err.code).toBe('validation_error'); expect(fieldErrorsOf(err)).toEqual({ email: 'bad' });
  });
  it('reports network failures with a friendly error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = (await api.get('/x').catch((e) => e)) as ApiError; expect(err.code).toBe('network_error'); expect(err.message).toMatch(/Cannot reach the server/);
  });
  it('refreshes once on 401 and retries the original request with the new token', async () => {
    setAccessToken('old');
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized', message: 'x' }))
      .mockResolvedValueOnce(json(200, { user: { id: 'u' }, accessToken: 'new', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { items: [] }));
    expect(await api.get('/tasks')).toEqual({ items: [] });
    expect(getAccessToken()).toBe('new'); expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh'); expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
  });
  it('signals auth loss when refresh fails, and never loops', async () => {
    const lost = vi.fn(); setAuthLostHandler(lost); setAccessToken('old');
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized', message: 'x' })).mockResolvedValueOnce(json(401, { error: 'invalid_refresh_token', message: 'x' }));
    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledOnce(); expect(getAccessToken()).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('concurrent refreshes are single-flight (one network call)', async () => {
    fetchMock.mockResolvedValue(json(200, { user: { id: 'u' }, accessToken: 'new', expiresIn: 900 }));
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a).toBe(b); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('retries once on refresh_race (another tab rotated the cookie)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(401, { error: 'refresh_race', message: 'x' })).mockResolvedValueOnce(json(200, { user: { id: 'u' }, accessToken: 'n2', expiresIn: 900 }));
    const p = refreshSession(); await vi.advanceTimersByTimeAsync(400); const r = await p; vi.useRealTimers();
    expect(r?.accessToken).toBe('n2'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('handles 204 responses', async () => { fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })); expect(await api.del('/tasks/1')).toBeUndefined(); });
});
