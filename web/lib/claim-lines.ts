import { z } from 'zod';
import { computeTotals } from './claim-totals';

// The levy rate in force since 2026-01-01. The server resolves the rate from the
// expense date against SurchargeRate, which no endpoint exposes; the preview
// assumes the current rate rather than adding one. A fuel expense back-dated
// before 2026-01-01 previews at 12.5% while the server stores 10% — the created
// claim is always correct because the server recomputes. (See DECISIONS.md.)
export const LEVY_RATE_PERCENT = 12.5;

// Mirrors ClaimLineDto (api/src/claims/dto/create-claim.dto.ts). Numeric fields
// travel as strings, validated with regex + refine, then coerced on submit —
// shared by the new-claim form and the reopen editor so both hold a line to the
// same rules.
export const lineSchema = z.object({
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

export type ClaimLineInput = z.infer<typeof lineSchema>;

export const emptyLine: ClaimLineInput = {
  description: '',
  quantity: '1',
  unitPrice: '',
  isFuel: false,
};

/** Ex-GST totals for a set of form lines, via the shared computeTotals mirror. */
export function previewTotals(lines: ClaimLineInput[]) {
  return computeTotals(
    lines.map((l) => ({
      // Blank/half-typed rows coerce to 0 so the preview never throws mid-entry.
      quantity: Number(l?.quantity) || 0,
      unitPrice: Number(l?.unitPrice) || 0,
      isFuel: Boolean(l?.isFuel),
    })),
    LEVY_RATE_PERCENT,
  );
}

/** Form lines → the numeric payload the API expects. */
export function linesToPayload(lines: ClaimLineInput[]) {
  return lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    isFuel: l.isFuel,
  }));
}
