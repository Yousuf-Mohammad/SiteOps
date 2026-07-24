'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, apiGet, apiPost } from '../../../lib/api/client';
import { queryKeys } from '../../../lib/query/keys';

// Mirrors the API's CreateDocketDto — money/hours travel as strings.
const docketSchema = z.object({
  projectId: z.string().min(1, 'Select a project'),
  equipmentId: z.string().min(1, 'Select plant'),
  workDate: z.string().min(1, 'Work date is required'),
  hours: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Hours must be a number with up to 2 decimals')
    .refine((v) => Number(v) > 0 && Number(v) <= 24, 'Hours must be between 0 and 24'),
  notes: z.string().max(500).optional(),
});

type DocketForm = z.infer<typeof docketSchema>;
type Option = { id: string; code?: string; assetCode?: string; name: string };

export default function NewDocketPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const projects = useQuery({
    queryKey: queryKeys.projects.list(1, 'ACTIVE'),
    queryFn: () => apiGet<Option[]>('/projects?pageSize=100&status=ACTIVE'),
  });
  const equipment = useQuery({
    queryKey: queryKeys.equipment.list(1),
    queryFn: () => apiGet<Option[]>('/equipment?pageSize=100'),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<DocketForm>({
    resolver: zodResolver(docketSchema),
    defaultValues: { hours: '8.00' },
  });

  const create = useMutation({
    mutationFn: (values: DocketForm) => apiPost('/dockets', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dockets.all });
      router.push('/dockets');
    },
    onError: (err) => {
      setError('root', {
        message: err instanceof ApiError ? err.message : 'Failed to create docket',
      });
    },
  });

  return (
    <>
      <div className="page-header">
        <h1>New Plant Docket</h1>
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
            {errors.projectId && <span style={{ color: 'var(--danger)' }}> {errors.projectId.message}</span>}
          </label>
          <label>
            Plant{' '}
            <select {...register('equipmentId')}>
              <option value="">Select plant…</option>
              {(equipment.data?.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.assetCode} — {e.name}
                </option>
              ))}
            </select>
            {errors.equipmentId && (
              <span style={{ color: 'var(--danger)' }}> {errors.equipmentId.message}</span>
            )}
          </label>
          <label>
            Work date <input type="date" {...register('workDate')} />
            {errors.workDate && <span style={{ color: 'var(--danger)' }}> {errors.workDate.message}</span>}
          </label>
          <label>
            Hours <input {...register('hours')} style={{ width: 90 }} />
            {errors.hours && <span style={{ color: 'var(--danger)' }}> {errors.hours.message}</span>}
          </label>
          <label>
            Notes <input {...register('notes')} placeholder="optional" />
          </label>
          {errors.root && <p style={{ color: 'var(--danger)' }}>{errors.root.message}</p>}
          <div>
            <button className="primary" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Create docket'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
