'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../lib/api/client';
import { queryKeys } from '../../lib/query/keys';

type Equipment = {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  hireRatePerDay: string;
  status: string;
};
type Meta = { total: number; page: number; pageCount: number };

const CATEGORIES = ['PAVER', 'ROLLER', 'TRUCK', 'EXCAVATOR', 'TRAFFIC', 'MISC'];

export default function EquipmentPage() {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.equipment.list(page, category || undefined),
    queryFn: () =>
      apiGet<Equipment[]>(`/equipment?page=${page}&pageSize=10${category ? `&category=${category}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const items = data?.data ?? [];
  const meta = data?.meta as Meta | undefined;

  return (
    <>
      <div className="page-header">
        <h1>Equipment</h1>
      </div>
      <div className="toolbar">
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        {isPending && <p className="pager">Loading…</p>}
        {isError && <p className="pager" style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {!isPending && !isError && (
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Day rate (ex-GST)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>{e.assetCode}</td>
                  <td>{e.name}</td>
                  <td>
                    <span className="badge">{e.category}</span>
                  </td>
                  <td className="num">${e.hireRatePerDay}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No equipment
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
