// TODO(old): predates lib/api/client.ts — claims screens still use this
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100/api';

export async function apiFetch(path: string, init?: RequestInit) {
  const userId =
    (typeof window !== 'undefined' && window.localStorage.getItem('siteops.userId')) ||
    process.env.NEXT_PUBLIC_FAKE_USER_ID ||
    '';
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
      'x-org-id': process.env.NEXT_PUBLIC_FAKE_ORG_ID ?? '',
      ...init?.headers,
    },
  });
  return res.json();
}
