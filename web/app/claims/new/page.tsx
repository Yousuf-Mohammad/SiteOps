'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

type Line = { description: string; quantity: string; unitPrice: string; isFuel: boolean };
type Project = { id: string; code: string; name: string };

const SURCHARGE = 0.125;

export default function NewClaimPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { description: '', quantity: '1', unitPrice: '', isFuel: false },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/projects?pageSize=100').then((res) => setProjects(res.data ?? []));
  }, []);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  let total = 0;
  for (const l of lines) {
    let amount = parseFloat(l.quantity) * parseFloat(l.unitPrice) || 0;
    if (l.isFuel) {
      amount += Math.round(amount * SURCHARGE * 100) / 100;
    }
    total += amount;
  }

  const submit = async () => {
    setSaving(true);
    await apiFetch('/claims', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        expenseDate,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: parseFloat(l.quantity),
          unitPrice: parseFloat(l.unitPrice),
          isFuel: l.isFuel,
        })),
      }),
    });
    router.push('/claims');
  };

  return (
    <>
      <div className="page-header">
        <h1>New Expense Claim</h1>
      </div>
      <div className="card" style={{ padding: 20 }}>
        <div className="form-grid">
          <label>
            Project{' '}
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expense date{' '}
            <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </label>

          {lines.map((l, i) => (
            <div className="line-row" key={i}>
              <input
                placeholder="Description"
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
              />
              <input
                type="number"
                placeholder="Qty"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
              />
              <input
                type="number"
                placeholder="Unit price"
                value={l.unitPrice}
                onChange={(e) => setLine(i, { unitPrice: e.target.value })}
              />
              <label>
                <input
                  type="checkbox"
                  checked={l.isFuel}
                  onChange={(e) => setLine(i, { isFuel: e.target.checked })}
                />{' '}
                fuel
              </label>
              <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <div>
            <button
              onClick={() =>
                setLines((ls) => [...ls, { description: '', quantity: '1', unitPrice: '', isFuel: false }])
              }
            >
              + Add line
            </button>
          </div>

          <div className="total-preview">Total: ${total.toFixed(2)}</div>

          <div>
            <button className="primary" disabled={saving} onClick={submit}>
              {saving ? 'Saving…' : 'Create draft'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
