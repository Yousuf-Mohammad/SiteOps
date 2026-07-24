'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../lib/api/client';
import { queryKeys } from '../../lib/query/keys';
import { useActingUser } from '../../lib/use-acting-user';

type Docket = {
  id: string;
  docketNumber: string;
  workDate: string;
  hours: string;
  status: string;
  project: { code: string };
  equipment: { assetCode: string; name: string };
};
type Meta = { total: number; page: number; pageCount: number };

export default function DocketsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { can } = useActingUser();
  const queryClient = useQueryClient();
  const [rowError, setRowError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.dockets.list(page, { status: status || undefined }),
    queryFn: () =>
      apiGet<Docket[]>(`/dockets?page=${page}&pageSize=10${status ? `&status=${status}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const confirm = useMutation({
    mutationFn: (id: string) => apiPost(`/dockets/${id}/confirm`, {}),
    onSuccess: () => {
      setRowError(null);
      // Confirmation changes docket lists AND project burn — refresh both.
      queryClient.invalidateQueries({ queryKey: queryKeys.dockets.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.burn });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : 'Confirmation failed'),
  });

  const dockets = data?.data ?? [];
  const meta = data?.meta as Meta | undefined;

  return (
    <>
      <div className="page-header">
        <h1>Plant Dockets</h1>
        <Link href="/dockets/new" className="btn primary">
          New docket
        </Link>
      </div>
      <div className="toolbar">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="CONFIRMED">Confirmed</option>
        </select>
        {rowError && <span style={{ color: 'var(--danger)' }}>{rowError}</span>}
      </div>
      <div className="card">
        {isPending && <p className="pager">Loading…</p>}
        {isError && <p className="pager" style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {!isPending && !isError && (
          <table>
            <thead>
              <tr>
                <th>Docket</th>
                <th>Project</th>
                <th>Plant</th>
                <th>Date</th>
                <th className="num">Hours</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dockets.map((d) => (
                <tr key={d.id}>
                  <td>{d.docketNumber}</td>
                  <td>{d.project.code}</td>
                  <td>
                    {d.equipment.assetCode} <span className="muted">{d.equipment.name}</span>
                  </td>
                  <td>{d.workDate.slice(0, 10)}</td>
                  <td className="num">{d.hours}</td>
                  <td>
                    <span className={`badge ${d.status}`}>{d.status}</span>
                  </td>
                  <td>
                    {d.status === 'DRAFT' && can('dockets.confirm') && (
                      <button disabled={confirm.isPending} onClick={() => confirm.mutate(d.id)}>
                        {confirm.isPending && confirm.variables === d.id ? 'Confirming…' : 'Confirm'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {dockets.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No dockets
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {meta && (
          <div className="pager">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span>
              Page {meta.page} of {Math.max(meta.pageCount, 1)} · {meta.total} total
            </span>
            <button disabled={page >= meta.pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}
