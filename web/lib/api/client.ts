// Platform API client: unwraps the { success, data, meta } envelope and
// attaches the fake-session headers. Use this for all new data access.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100/api';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function getActingUserId(): string {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('siteops.userId');
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_FAKE_USER_ID ?? '';
}

export function getOrgId(): string {
  return process.env.NEXT_PUBLIC_FAKE_ORG_ID ?? '';
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; meta?: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getActingUserId(),
      'x-org-id': getOrgId(),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const message = Array.isArray(body?.error?.message)
      ? body.error.message.join(', ')
      : (body?.error?.message ?? body?.message ?? `Request failed (${res.status})`);
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', message, res.status);
  }
  return { data: body.data as T, meta: body.meta };
}

export const apiGet = <T>(path: string) => request<T>(path);
export const apiPost = <T>(path: string, payload: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(payload) });
