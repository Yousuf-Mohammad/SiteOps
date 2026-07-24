'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Claim = {
  id: string;
  reference: string;
  status: string;
  expenseDate: string;
  // Decimal columns serialise as strings over JSON since the claims money migration.
  total: string | number;
  project?: { code: string; name: string };
};

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([]);

  useEffect(() => {
    apiFetch('/claims').then((res) => setClaims(res.data ?? res));
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>Expense Claims</h1>
        <Link href="/claims/new" className="btn primary">
          New claim
        </Link>
      </div>
      <div className="card">
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
                  <span className={`badge ${c.status}`}>{c.status}</span>
                </td>
                <td className="num">${Number(c.total).toFixed(2)}</td>
              </tr>
            ))}
            {claims.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No claims yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
