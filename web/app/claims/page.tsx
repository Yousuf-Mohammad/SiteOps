'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { apiGet } from '../../lib/api/client';
import { queryKeys } from '../../lib/query/keys';

type Claim = {
  id: string;
  reference: string;
  status: string;
  expenseDate: string;
  // Decimal columns serialise as strings over JSON since the claims money
  // migration — always coerce before formatting.
  total: string | number;
  project?: { code: string; name: string };
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

  const claims = data?.data ?? [];
  const meta = data?.meta as Meta | undefined;

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
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>{c.reference}</td>
                  <td>{c.project?.code ?? '—'}</td>
                  <td>{c.expenseDate.slice(0, 10)}</td>
                  <td>
                    <span className={`badge ${c.status}`}>{c.status.replace('_', ' ')}</span>
                  </td>
                  <td className="num">${Number(c.total).toFixed(2)}</td>
                </tr>
              ))}
              {claims.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
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
