'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../lib/api/client';
import { queryKeys } from '../../lib/query/keys';

type ProjectBurn = {
  projectId: string;
  code: string;
  name: string;
  status: string;
  approvedClaims: number;
  confirmedPlant: number;
  burn: number;
};

const money = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export default function DashboardPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.reports.burn,
    queryFn: () => apiGet<ProjectBurn[]>('/reports/burn'),
  });

  const rows = data?.data ?? [];
  const max = Math.max(...rows.map((r) => r.burn), 1);

  return (
    <>
      <div className="page-header">
        <h1>Burn by Project</h1>
        <span className="muted">approved claims + confirmed plant, ex-GST</span>
      </div>
      <div className="card" style={{ padding: 20 }}>
        {isPending && <p className="muted">Loading…</p>}
        {isError && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {!isPending && !isError && rows.length === 0 && <p className="muted">No projects</p>}
        {rows.map((r) => (
          <div key={r.projectId} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>
                <strong>{r.code}</strong> <span className="muted">{r.name}</span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.burn)}</span>
            </div>
            <div style={{ background: '#eef0f3', borderRadius: 4, height: 10, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(r.burn / max) * 100}%`,
                  background: 'var(--accent)',
                  height: '100%',
                }}
              />
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              claims {money(r.approvedClaims)} · plant {money(r.confirmedPlant)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
