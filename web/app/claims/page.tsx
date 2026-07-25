'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../lib/api/client';
import { queryKeys } from '../../lib/query/keys';
import { useActingUser } from '../../lib/use-acting-user';

type Decision = { actorId: string; revision: number };
type Claim = {
  id: string;
  reference: string;
  status: string;
  revision: number;
  submitterId: string;
  expenseDate: string;
  // Decimal columns serialise as strings over JSON since the claims money
  // migration — always coerce before formatting.
  total: string | number;
  project?: { code: string; name: string };
  decisions: Decision[];
};
type Meta = { total: number; page: number; pageCount: number };

// The set the server validates against — CLAIM_STATUSES in
// api/src/claims/dto/list-claims.dto.ts is the source of truth.
const STATUSES = ['DRAFT', 'SUBMITTED', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED'] as const;

export default function ClaimsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  // FY is a free 0–99 value on the server, not an enumerable list, so it is a
  // number input rather than a select. Held as a string to keep the field
  // controlled while empty.
  const [fy, setFy] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  const { user, can } = useActingUser();
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.claims.list(page, { status: status || undefined, fy: fy || undefined }),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (status) params.set('status', status);
      if (fy) params.set('fy', fy);
      return apiGet<Claim[]>(`/claims?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  // Lodgment changes only the claim lists; a decision also moves the burn
  // dashboard (house rule). Both share one row-error slot, like the dockets list.
  const submit = useMutation({
    mutationFn: (id: string) => apiPost(`/claims/${id}/submit`, {}),
    onSuccess: () => {
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.claims.all });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : 'Submit failed'),
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'approve' | 'reject' }) =>
      apiPost(`/claims/${v.id}/${v.action}`, {}),
    onSuccess: () => {
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.claims.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.burn });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : 'Decision failed'),
  });

  const claims = data?.data ?? [];
  const meta = data?.meta as Meta | undefined;
  const actingId = user?.id ?? '';
  const busy = submit.isPending || decide.isPending;

  // The same gating the detail page uses, so the table offers exactly the actions
  // the acting user could actually take — never a button that only 409s.
  const actionsFor = (c: Claim) => {
    const isSubmitter = actingId === c.submitterId;
    const decided = c.decisions.some((d) => d.revision === c.revision && d.actorId === actingId);
    return {
      canSubmit: c.status === 'DRAFT' && isSubmitter,
      canDecide:
        can('claims.approve') &&
        !isSubmitter &&
        !decided &&
        (c.status === 'SUBMITTED' || c.status === 'PARTIALLY_APPROVED'),
    };
  };

  return (
    <>
      <div className="page-header">
        <h1>Expense Claims</h1>
        <Link href="/claims/new" className="btn primary">
          New claim
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
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="FY (e.g. 26)"
          min={0}
          max={99}
          value={fy}
          onChange={(e) => {
            setFy(e.target.value);
            setPage(1);
          }}
          style={{ width: 120 }}
        />
        {rowError && <span style={{ color: 'var(--danger)' }}>{rowError}</span>}
      </div>
      <div className="card">
        {isPending && <p className="pager">Loading…</p>}
        {isError && (
          <p className="pager" style={{ color: 'var(--danger)' }}>
            {(error as Error).message}
          </p>
        )}
        {!isPending && !isError && (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Project</th>
                <th>Date</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => {
                const { canSubmit, canDecide } = actionsFor(c);
                const submitting = submit.isPending && submit.variables === c.id;
                const deciding = decide.isPending && decide.variables?.id === c.id;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/claims/${c.id}`}>{c.reference}</Link>
                    </td>
                    <td>{c.project?.code ?? '—'}</td>
                    <td>{c.expenseDate.slice(0, 10)}</td>
                    <td>
                      <span className={`badge ${c.status}`}>{c.status.replace('_', ' ')}</span>
                    </td>
                    <td className="num">${Number(c.total).toFixed(2)}</td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {canSubmit && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => submit.mutate(c.id)}
                        >
                          {submitting ? 'Submitting…' : 'Submit'}
                        </button>
                      )}
                      {canDecide && (
                        <>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => decide.mutate({ id: c.id, action: 'approve' })}
                          >
                            {deciding && decide.variables?.action === 'approve'
                              ? 'Approving…'
                              : 'Approve'}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => decide.mutate({ id: c.id, action: 'reject' })}
                          >
                            {deciding && decide.variables?.action === 'reject'
                              ? 'Rejecting…'
                              : 'Reject'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {claims.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No claims
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
