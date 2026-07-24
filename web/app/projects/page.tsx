'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { apiGet } from '../../lib/api/client';
import { queryKeys } from '../../lib/query/keys';

type Project = { id: string; code: string; name: string; status: string; createdAt: string };
type Meta = { total: number; page: number; pageSize: number; pageCount: number };

export default function ProjectsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.projects.list(page, status || undefined),
    queryFn: () =>
      apiGet<Project[]>(`/projects?page=${page}&pageSize=10${status ? `&status=${status}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const projects = data?.data ?? [];
  const meta = data?.meta as Meta | undefined;

  return (
    <>
      <div className="page-header">
        <h1>Projects</h1>
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
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>
      <div className="card">
        {isPending && <p className="pager">Loading…</p>}
        {isError && <p className="pager" style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {!isPending && !isError && (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.code}</Link>
                  </td>
                  <td>{p.name}</td>
                  <td>
                    <span className={`badge ${p.status}`}>{p.status}</span>
                  </td>
                  <td>{p.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No projects
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
