'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ClaimLineFields, TotalPreview } from '../../../components/claim-line-fields';
import { ApiError, apiGet, apiPost } from '../../../lib/api/client';
import { emptyLine, lineSchema, linesToPayload } from '../../../lib/claim-lines';
import { queryKeys } from '../../../lib/query/keys';

const claimSchema = z.object({
  projectId: z.string().min(1, 'Select a project'),
  expenseDate: z.string().min(1, 'Expense date is required'),
  lines: z.array(lineSchema).min(1, 'At least one line'),
});

type ClaimForm = z.infer<typeof claimSchema>;
type Project = { id: string; code: string; name: string };

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

  const create = useMutation({
    mutationFn: (values: ClaimForm) =>
      apiPost('/claims', {
        projectId: values.projectId,
        expenseDate: values.expenseDate,
        lines: linesToPayload(values.lines),
      }),
    onSuccess: () => {
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

          <ClaimLineFields control={control} register={register} errors={errors} />

          <TotalPreview control={control} />

          {errors.lines?.message && <p style={{ color: 'var(--danger)' }}>{errors.lines.message}</p>}
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
