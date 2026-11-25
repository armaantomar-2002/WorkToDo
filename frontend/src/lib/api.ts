// The ONLY module that talks to the network. Access token lives in memory (never localStorage); the refresh token is an
// HttpOnly cookie managed by the browser. Refresh is single-flight so concurrent 401s trigger exactly one rotation.
import type { AuthResult } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1';

export interface FieldError { field: string; message: string; taskIds?: string[] }
export class ApiError extends Error {
  status: number; code: string; errors?: FieldError[]; errorId?: string;
  constructor(status: number, code: string, message: string, errors?: FieldError[], errorId?: string) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.errors = errors; this.errorId = errorId; }
}

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setAuthLostHandler = (fn: (() => void) | null) => { onAuthLost = fn; };

interface RequestOptions { auth?: boolean; retryOnAuth?: boolean; query?: Record<string, string | number | boolean | undefined | null | string[]> }

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function send<T>(method: string, path: string, body: unknown, opts: RequestOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method, credentials: 'include',
      headers: { 'X-Requested-With': 'WorkToDo', Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.auth !== false && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and that the backend is running.');
  }
  if (res.status === 204) return undefined as T;
  let data: { error?: string; message?: string; errors?: FieldError[]; errorId?: string } | null = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (res.ok) return data as T;
  const err = new ApiError(res.status, data?.error ?? 'http_error', data?.message ?? `Request failed (${res.status})`, data?.errors, data?.errorId);
  if (res.status === 401 && opts.auth !== false && opts.retryOnAuth !== false && err.code === 'unauthorized') {
    if (await refreshSession()) return send<T>(method, path, body, { ...opts, retryOnAuth: false });
    onAuthLost?.();
  }
  throw err;
}

let inflight: Promise<AuthResult | null> | null = null;
/** Rotates the refresh cookie and stores the new access token. Resolves null when there is no valid session. */
export function refreshSession(): Promise<AuthResult | null> {
  inflight ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await send<AuthResult>('POST', '/auth/refresh', {}, { auth: false });
          accessToken = result.accessToken;
          return result;
        } catch (e) {
          // Another tab rotated the cookie a moment ago: the browser cookie jar already holds the new token, so retry once.
          if (e instanceof ApiError && e.code === 'refresh_race' && attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
          if (e instanceof ApiError && e.code === 'network_error') throw e;
          accessToken = null;
          return null;
        }
      }
      return null;
    } finally { inflight = null; }
  })();
  return inflight;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], opts: Omit<RequestOptions, 'query'> = {}) => send<T>('GET', path, undefined, { ...opts, query }),
  post: <T>(path: string, body: unknown = {}, opts: RequestOptions = {}) => send<T>('POST', path, body, opts),
  patch: <T>(path: string, body: unknown, opts: RequestOptions = {}) => send<T>('PATCH', path, body, opts),
  put: <T>(path: string, body: unknown, opts: RequestOptions = {}) => send<T>('PUT', path, body, opts),
  del: <T = void>(path: string, opts: RequestOptions = {}) => send<T>('DELETE', path, undefined, opts),
};

/** Maps backend validation errors onto form field names (used with react-hook-form's setError). */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (err instanceof ApiError && err.errors) for (const e of err.errors) if (!(e.field in out)) out[e.field] = e.message;
  return out;
}
export const messageOf = (err: unknown): string => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong');
