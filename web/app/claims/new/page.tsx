'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, apiGet, apiPost } from '../../../lib/api/client';
import { computeTotals } from '../../../lib/claim-totals';
import { queryKeys } from '../../../lib/query/keys';

// The levy rate in force since 2026-01-01. The server resolves the rate from the
// expense date against SurchargeRate, which no endpoint exposes; the preview
// assumes the current rate rather than adding one. Consequence: a fuel expense
// back-dated before 2026-01-01 previews at 12.5% while the server stores 10%.
// Every present-day claim and both golden examples match exactly, and the server
// is authoritative — the created claim is always correct. (See DECISIONS.md.)
const LEVY_RATE_PERCENT = 12.5;

// Mirrors CreateClaimDto + ClaimLineDto (api/src/claims/dto/create-claim.dto.ts).
// Numeric fields travel as strings, validated with regex + refine, then coerced
// on submit — the same shape the dockets form uses.
const lineSchema = z.object({
  description: z.string().min(1, 'Required').max(500),
  quantity: z
    .string()
    .regex(/^\d+$/, 'Whole number')
    .refine((v) => Number(v) > 0, 'Must be > 0'),
  unitPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Up to 2 decimals')
    .refine((v) => Number(v) > 0, 'Must be > 0'),
  isFuel: z.boolean(),
});

const claimSchema = z.object({
  projectId: z.string().min(1, 'Select a project'),
  expenseDate: z.string().min(1, 'Expense date is required'),
  lines: z.array(lineSchema).min(1, 'At least one line'),
});

type ClaimForm = z.infer<typeof claimSchema>;
type Project = { id: string; code: string; name: string };

const emptyLine = { description: '', quantity: '1', unitPrice: '', isFuel: false };

// Isolated so the total recomputes on keystroke without re-rendering the whole
// form tree. useWatch here subscribes only to `lines`.
function TotalPreview({ control }: { control: Control<ClaimForm> }) {
  const lines = useWatch({ control, name: 'lines' }) ?? [];
  const totals = computeTotals(
    lines.map((l) => ({
      // Blank/half-typed rows coerce to 0 so the preview never throws mid-entry.
      quantity: Number(l?.quantity) || 0,
      unitPrice: Number(l?.unitPrice) || 0,
      isFuel: Boolean(l?.isFuel),
    })),
    LEVY_RATE_PERCENT,
  );

  return (
    <div className="total-preview">
      Fuel levy ({LEVY_RATE_PERCENT}%): ${totals.levyAmount.toFixed(2)}
      <br />
      Total (ex-GST): ${totals.total.toFixed(2)}
    </div>
  );
}

export default function NewClaimPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const projects = useQuery({
    queryKey: queryKeys.projects.list(1),
    queryFn: () => apiGet<Project[]>('/projects?pageSize=100'),
  });

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<ClaimForm>({
    resolver: zodResolver(claimSchema),
    defaultValues: { projectId: '', expenseDate: '', lines: [{ ...emptyLine }] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const create = useMutation({
    mutationFn: (values: ClaimForm) =>
      apiPost('/claims', {
        projectId: values.projectId,
        expenseDate: values.expenseDate,
        lines: values.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          isFuel: l.isFuel,
        })),
      }),
    onSuccess: () => {
      // Approved claims aside, a new DRAFT still belongs in the list immediately.
      queryClient.invalidateQueries({ queryKey: queryKeys.claims.all });
      router.push('/claims');
    },
    onError: (err) => {
      setError('root', {
        message: err instanceof ApiError ? err.message : 'Failed to create claim',
      });
    },
  });

  return (
    <>
      <div className="page-header">
        <h1>New Expense Claim</h1>
      </div>
      <div className="card" style={{ padding: 20 }}>
        <form className="form-grid" onSubmit={handleSubmit((v) => create.mutate(v))}>
          <label>
            Project{' '}
            <select {...register('projectId')}>
              <option value="">Select project…</option>
              {(projects.data?.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            {errors.projectId && (
              <span style={{ color: 'var(--danger)' }}> {errors.projectId.message}</span>
            )}
          </label>
          <label>
            Expense date <input type="date" {...register('expenseDate')} />
            {errors.expenseDate && (
              <span style={{ color: 'var(--danger)' }}> {errors.expenseDate.message}</span>
            )}
          </label>

          {fields.map((field, i) => (
            <div className="line-row" key={field.id}>
              <div>
                <input placeholder="Description" {...register(`lines.${i}.description`)} />
                {errors.lines?.[i]?.description && (
                  <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                    {' '}
                    {errors.lines[i]?.description?.message}
                  </span>
                )}
              </div>
              <div>
                <input type="number" placeholder="Qty" {...register(`lines.${i}.quantity`)} />
                {errors.lines?.[i]?.quantity && (
                  <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                    {' '}
                    {errors.lines[i]?.quantity?.message}
                  </span>
                )}
              </div>
              <div>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Unit price"
                  {...register(`lines.${i}.unitPrice`)}
                />
                {errors.lines?.[i]?.unitPrice && (
                  <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                    {' '}
                    {errors.lines[i]?.unitPrice?.message}
                  </span>
                )}
              </div>
              <label>
                <input type="checkbox" {...register(`lines.${i}.isFuel`)} /> fuel
              </label>
              <button type="button" onClick={() => remove(i)} disabled={fields.length === 1}>
                ×
              </button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => append({ ...emptyLine })}>
              + Add line
            </button>
          </div>

          <TotalPreview control={control} />

          {errors.lines?.message && (
            <p style={{ color: 'var(--danger)' }}>{errors.lines.message}</p>
          )}
          {errors.root && <p style={{ color: 'var(--danger)' }}>{errors.root.message}</p>}
          <div>
            <button className="primary" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Create draft'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
