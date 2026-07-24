'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../lib/api/client';
import { queryKeys } from '../lib/query/keys';

type Note = { id: string; body: string; authorName: string; createdAt: string };

export function NotesPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: queryKeys.notes.forEntity(entityType, entityId),
    queryFn: () => apiGet<Note[]>(`/notes?entityType=${entityType}&entityId=${entityId}`),
  });

  const addNote = useMutation({
    mutationFn: () => apiPost('/notes', { entityType, entityId, body }),
    onSuccess: () => {
      setBody('');
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.forEntity(entityType, entityId) });
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : 'Failed to add note'),
  });

  const notes = data?.data ?? [];

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Site notes</h3>
      {isPending && <p className="muted">Loading…</p>}
      {notes.map((n) => (
        <div key={n.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {n.authorName} · {n.createdAt.slice(0, 10)}
          </div>
          <div>{n.body}</div>
        </div>
      ))}
      {!isPending && notes.length === 0 && <p className="muted">No notes yet</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          style={{ flex: 1 }}
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button disabled={!body.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
          Add
        </button>
      </div>
      {errorMsg && <p style={{ color: 'var(--danger)' }}>{errorMsg}</p>}
    </div>
  );
}
