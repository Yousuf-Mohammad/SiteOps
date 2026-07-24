'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import Link from 'next/link';
import { use } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ClaimLineFields, TotalPreview } from '../../../components/claim-line-fields';
import { ApiError, apiGet, apiPost } from '../../../lib/api/client';
import { lineSchema, linesToPayload, type ClaimLineInput } from '../../../lib/claim-lines';
import { queryKeys } from '../../../lib/query/keys';
import { useActingUser } from '../../../lib/use-acting-user';

type Line = { id: string; description: string; quantity: number; unitPrice: string; isFuel: boolean };
type Decision = { id: string; revision: number; actorId: string; decision: string; createdAt: string };
type Audit = {
  id: string;
  actorId: string;
  action: string;
  before: { status?: string } | null;
  after: { status?: string } | null;
  createdAt: string;
};
type Claim = {
  id: string;
  reference: string;
  status: string;
  revision: number;
  submitterId: string;
  expenseDate: string;
  total: string;
  levyRatePercent: string;
  fuelSubtotal: string;
  levyAmount: string;
  project?: { code: string; name: string };
  lines: Line[];
  decisions: Decision[];
  audit: Audit[];
};

const money = (v: Decimal.Value) => `$${new Decimal(v).toFixed(2)}`;
const GST = new Decimal('0.10'); // Display-only. Nothing is stored or thresholded inc-GST.

// Human labels for the audit trail — keyed by the actions the service records.
const ACTION_LABEL: Record<string, string> = {
  'claim.created': 'Created',
  'claim.submitted': 'Submitted',
  'claim.partially_approved': 'First approval',
  'claim.approved': 'Approved (final)',
  'claim.rejected': 'Rejected',
  'claim.reopened': 'Reopened for correction',
};

const reopenSchema = z.object({ lines: z.array(lineSchema).min(1, 'At least one line') });
type ReopenForm = z.infer<typeof reopenSchema>;

export default function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { user, users, can } = useActingUser();

  const query = useQuery({
    queryKey: queryKeys.claims.detail(id),
    queryFn: () => apiGet<Claim>(`/claims/${id}`),
  });

  const nameOf = (userId: string) => users.find((u) => u.id === userId)?.name ?? 'Someone';

  // Lodgment: the submitter sending their own draft for review. No burn change —
  // nothing is approved yet. The ['claims'] prefix refetches this detail and the
  // list.
  const submit = useMutation({
    mutationFn: () => apiPost(`/claims/${id}/submit`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.claims.all }),
  });

  // Approve/reject both change claim lists and, on final approval, the burn
  // dashboard — invalidate both (house rule). The ['claims'] prefix covers this
  // detail query and the list.
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject') => apiPost(`/claims/${id}/${action}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.claims.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.burn });
    },
  });

  if (query.isPending) return <p className="muted">Loading…</p>;
  if (query.isError) return <p style={{ color: 'var(--danger)' }}>{(query.error as Error).message}</p>;

  const claim = query.data.data;
  const gst = new Decimal(claim.total).times(GST).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const incGst = new Decimal(claim.total).plus(gst);

  const actingId = user?.id ?? '';
  const isSubmitter = actingId === claim.submitterId;
  const canDecide =
    can('claims.approve') &&
    !isSubmitter &&
    (claim.status === 'SUBMITTED' || claim.status === 'PARTIALLY_APPROVED');
  // Only the claim's own submitter lodges it, and only from DRAFT — mirrors the
  // server's ownership + state rule.
  const canSubmit = isSubmitter && claim.status === 'DRAFT';

  // The first key on THIS revision — revision-scoped so a reopened claim's old
  // decisions never mislead about who is pending.
  const firstKey = claim.decisions.find(
    (d) => d.revision === claim.revision && d.decision === 'APPROVE',
  );

  return (
    <>
      <div className="page-header">
        <h1>
          {claim.reference}{' '}
          <span className="muted">{claim.project?.code}</span>
          {claim.revision > 1 && <span className="muted"> · rev {claim.revision}</span>}
        </h1>
        <span className={`badge ${claim.status}`}>{claim.status.replace('_', ' ')}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Unit price</th>
                <th>Fuel</th>
                <th className="num">Line total</th>
              </tr>
            </thead>
            <tbody>
              {claim.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{money(l.unitPrice)}</td>
                  <td>{l.isFuel ? 'fuel' : ''}</td>
                  <td className="num">{money(new Decimal(l.unitPrice).times(l.quantity))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ padding: '12px 4px', display: 'grid', gap: 4, maxWidth: 320 }}>
            <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                Fuel levy ({new Decimal(claim.levyRatePercent).toFixed(2)}% on {money(claim.fuelSubtotal)})
              </span>
              <span>{money(claim.levyAmount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Total (ex-GST)</span>
              <span>{money(claim.total)}</span>
            </div>
            <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>GST (10%, for reference)</span>
              <span>{money(gst)}</span>
            </div>
            <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Total (inc-GST, for reference)</span>
              <span>{money(incGst)}</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>History</h3>
          <ul className="timeline">
            {claim.audit.map((a) => (
              <li key={a.id}>
                <div>
                  <strong>{ACTION_LABEL[a.action] ?? a.action}</strong>
                  {a.before?.status && a.after?.status && (
                    <span className="muted">
                      {' '}
                      {a.before.status} → {a.after.status}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {nameOf(a.actorId)} · {new Date(a.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {canSubmit && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <button className="primary" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Submitting…' : 'Submit for approval'}
          </button>
          {submit.isError && (
            <p style={{ color: 'var(--danger)' }}>
              {submit.error instanceof ApiError ? submit.error.message : 'Submit failed'}
            </p>
          )}
        </div>
      )}

      {claim.status === 'PARTIALLY_APPROVED' && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          🔑 <strong>{firstKey ? nameOf(firstKey.actorId) : 'An approver'}</strong> turned the first key
          {firstKey && ` on ${new Date(firstKey.createdAt).toLocaleDateString()}`}. Awaiting a second,
          different approver.
        </div>
      )}

      {canDecide && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <button
            className="primary"
            disabled={decide.isPending}
            onClick={() => decide.mutate('approve')}
          >
            Approve
          </button>{' '}
          <button disabled={decide.isPending} onClick={() => decide.mutate('reject')}>
            Reject
          </button>
          {decide.isError && (
            <p style={{ color: 'var(--danger)' }}>
              {decide.error instanceof ApiError ? decide.error.message : 'Decision failed'}
            </p>
          )}
        </div>
      )}

      {claim.status === 'REJECTED' && isSubmitter && (
        <ReopenEditor claim={claim} onDone={() => query.refetch()} />
      )}

      <p style={{ marginTop: 16 }}>
        <Link href="/claims">← Back to claims</Link>
      </p>
    </>
  );
}

function ReopenEditor({ claim, onDone }: { claim: Claim; onDone: () => void }) {
  const queryClient = useQueryClient();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<ReopenForm>({
    resolver: zodResolver(reopenSchema),
    // Pre-fill with the rejected claim's lines so the supervisor edits, not retypes.
    defaultValues: {
      lines: claim.lines.map(
        (l): ClaimLineInput => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: new Decimal(l.unitPrice).toFixed(2),
          isFuel: l.isFuel,
        }),
      ),
    },
  });

  const reopen = useMutation({
    mutationFn: (values: ReopenForm) =>
      apiPost(`/claims/${claim.id}/reopen`, { lines: linesToPayload(values.lines) }),
    onSuccess: () => {
      // Back to DRAFT — nothing approved, so burn is untouched; just the claims.
      queryClient.invalidateQueries({ queryKey: queryKeys.claims.all });
      onDone();
    },
    onError: (err) => {
      setError('root', {
        message: err instanceof ApiError ? err.message : 'Failed to reopen claim',
      });
    },
  });

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Correct and reopen</h3>
      <p className="muted">
        Fix the lines and reopen this rejected claim as a new revision. The reference, expense date and levy
        rate stay the same.
      </p>
      <form className="form-grid" onSubmit={handleSubmit((v) => reopen.mutate(v))}>
        <ClaimLineFields control={control} register={register} errors={errors} />
        <TotalPreview control={control} />
        {errors.lines?.message && <p style={{ color: 'var(--danger)' }}>{errors.lines.message}</p>}
        {errors.root && <p style={{ color: 'var(--danger)' }}>{errors.root.message}</p>}
        <div>
          <button className="primary" type="submit" disabled={reopen.isPending}>
            {reopen.isPending ? 'Reopening…' : 'Reopen with corrections'}
          </button>
        </div>
      </form>
    </div>
  );
}
