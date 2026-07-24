'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { NotesPanel } from '../../../components/notes-panel';
import { apiGet } from '../../../lib/api/client';
import { queryKeys } from '../../../lib/query/keys';

type Project = { id: string; code: string; name: string; status: string; createdAt: string };
type Docket = {
  id: string;
  docketNumber: string;
  workDate: string;
  hours: string;
  status: string;
  equipment: { assetCode: string };
};

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const project = useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => apiGet<Project>(`/projects/${id}`),
  });
  const dockets = useQuery({
    queryKey: queryKeys.dockets.list(1, { projectId: id }),
    queryFn: () => apiGet<Docket[]>(`/dockets?projectId=${id}&pageSize=20`),
  });

  const p = project.data?.data;

  return (
    <>
      {project.isPending && <p className="muted">Loading…</p>}
      {project.isError && (
        <p style={{ color: 'var(--danger)' }}>{(project.error as Error).message}</p>
      )}
      {p && (
        <>
          <div className="page-header">
            <h1>
              {p.code} <span className="muted">{p.name}</span>
            </h1>
            <span className={`badge ${p.status}`}>{p.status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Docket</th>
                    <th>Plant</th>
                    <th>Date</th>
                    <th className="num">Hours</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(dockets.data?.data ?? []).map((d) => (
                    <tr key={d.id}>
                      <td>{d.docketNumber}</td>
                      <td>{d.equipment.assetCode}</td>
                      <td>{d.workDate.slice(0, 10)}</td>
                      <td className="num">{d.hours}</td>
                      <td>
                        <span className={`badge ${d.status}`}>{d.status}</span>
                      </td>
                    </tr>
                  ))}
                  {(dockets.data?.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No dockets for this project
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <NotesPanel entityType="project" entityId={id} />
          </div>
        </>
      )}
    </>
  );
}
