'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, getActingUserId } from './api/client';
import { queryKeys } from './query/keys';

export type OrgUser = { id: string; name: string; email: string; permissions: string[] };

/**
 * The acting user, resolved from the switcher + the /users endpoint.
 * `can()` gates UI affordances only — the API enforces the real rules.
 */
export function useActingUser() {
  const [actingId, setActingId] = useState('');
  useEffect(() => setActingId(getActingUserId()), []);

  const { data } = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => apiGet<OrgUser[]>('/users'),
  });

  const users = data?.data ?? [];
  const user = users.find((u) => u.id === actingId) ?? null;
  const can = (permission: string) => user?.permissions.includes(permission) ?? false;

  return { user, users, can };
}
