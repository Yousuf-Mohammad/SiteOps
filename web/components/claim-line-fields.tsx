'use client';

import {
  useFieldArray,
  useWatch,
  type ArrayPath,
  type Control,
  type FieldErrors,
  type FieldValues,
  type Path,
  type UseFormRegister,
} from 'react-hook-form';
import {
  emptyLine,
  LEVY_RATE_PERCENT,
  previewTotals,
  type ClaimLineInput,
} from '../lib/claim-lines';

/** Any form the line editor drives — it manages a `lines` field and nothing else. */
interface LinesForm extends FieldValues {
  lines: ClaimLineInput[];
}

type LineErrors = Array<{
  description?: { message?: string };
  quantity?: { message?: string };
  unitPrice?: { message?: string };
}>;

/**
 * Live ex-GST total for the watched lines, via the shared `computeTotals`
 * mirror. Isolated in its own component so it re-renders on keystroke without
 * dragging the whole form with it.
 */
export function TotalPreview<T extends LinesForm>({
  control,
  ratePercent = LEVY_RATE_PERCENT,
}: {
  control: Control<T>;
  /** Effective-dated levy rate for the claim's expense date (or the snapshot on reopen). */
  ratePercent?: number | string;
}) {
  const lines = (useWatch({ control, name: 'lines' as Path<T> }) as ClaimLineInput[] | undefined) ?? [];
  const totals = previewTotals(lines, ratePercent);

  return (
    <div className="total-preview">
      Fuel levy ({Number(ratePercent)}%): ${totals.levyAmount.toFixed(2)}
      <br />
      Total (ex-GST): ${totals.total.toFixed(2)}
    </div>
  );
}

/**
 * The line-item field array — description / qty / unit price / fuel, with
 * add and remove. Shared by the new-claim form and the reopen editor so a line
 * is entered and validated identically in both.
 */
export function ClaimLineFields<T extends LinesForm>({
  control,
  register,
  errors,
}: {
  control: Control<T>;
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' as ArrayPath<T> });
  type AppendValue = Parameters<typeof append>[0];
  const lineErrors = (errors as unknown as FieldErrors<LinesForm>).lines as LineErrors | undefined;

  return (
    <>
      {fields.map((field, i) => {
        const e = lineErrors?.[i];
        return (
          <div className="line-row" key={field.id}>
            <div>
              <input placeholder="Description" {...register(`lines.${i}.description` as Path<T>)} />
              {e?.description && (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}> {e.description.message}</span>
              )}
            </div>
            <div>
              <input type="number" placeholder="Qty" {...register(`lines.${i}.quantity` as Path<T>)} />
              {e?.quantity && (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}> {e.quantity.message}</span>
              )}
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                placeholder="Unit price"
                {...register(`lines.${i}.unitPrice` as Path<T>)}
              />
              {e?.unitPrice && (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}> {e.unitPrice.message}</span>
              )}
            </div>
            <label>
              <input type="checkbox" {...register(`lines.${i}.isFuel` as Path<T>)} /> fuel
            </label>
            <button type="button" onClick={() => remove(i)} disabled={fields.length === 1}>
              ×
            </button>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          onClick={() => append({ ...emptyLine } as AppendValue)}
        >
          + Add line
        </button>
      </div>
    </>
  );
}
