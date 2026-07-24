'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, getActingUserId } from '../lib/api/client';
import { queryKeys } from '../lib/query/keys';

type OrgUser = { id: string; name: string; email: string; permissions: string[] };

export function UserSwitcher() {
  const [current, setCurrent] = useState('');
  useEffect(() => setCurrent(getActingUserId()), []);

  const { data } = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => apiGet<OrgUser[]>('/users'),
  });

  const users = data?.data ?? [];

  return (
    <select
      value={current}
      onChange={(e) => {
        window.localStorage.setItem('siteops.userId', e.target.value);
        window.location.reload();
      }}
    >
      {users.length === 0 && <option value={current}>loading…</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {u.permissions.includes('claims.approve') ? ' (approver)' : ''}
        </option>
      ))}
    </select>
  );
}
