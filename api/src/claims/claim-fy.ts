import DecimalJs from 'decimal.js';

/**
 * Financial year and effective-dated levy rate.
 *
 * Pure, like `claim-totals.ts` — no Prisma, no Nest, and deliberately no clock.
 * The rate resolver takes the org's rates as an argument; fetching them is the
 * caller's job (Phase 4), which keeps this unit-testable without a database.
 */

/** July, zero-indexed. The Australian FY opens on the 1st of this month. */
const FY_START_MONTH_UTC = 6;

/**
 * Two-digit financial year for an expense date. FY runs 1 Jul – 30 Jun and is
 * named for the year it *ends*: 2026-02-10 -> 26, 2026-08-01 -> 27.
 *
 * Derived from the expense date and nothing else. The starter used
 * `new Date().getFullYear()`, so the same claim would be stamped differently
 * depending on when it happened to be created — references have to be
 * reproducible.
 *
 * UTC accessors are load-bearing. Expense dates are stored as UTC midnight, and
 * local getters would shift the day across the FY boundary: 2026-07-01T00:00Z
 * reads as 30 June anywhere west of Greenwich, quietly producing FY26.
 */
export function fyForDate(date: Date): number {
  const year = date.getUTCFullYear();
  const closingYear = date.getUTCMonth() >= FY_START_MONTH_UTC ? year + 1 : year;
  return closingYear % 100;
}

/** Shape of a `SurchargeRate` row, structurally typed so Prisma stays out of this module. */
export interface EffectiveRate {
  ratePercent: DecimalJs.Value;
  effectiveFrom: Date;
}

/**
 * The levy rate in force on `expenseDate` — the latest rate whose
 * `effectiveFrom` is on or before it. `effectiveFrom` is inclusive, so an
 * expense dated exactly 2026-01-01 attracts the new 12.5%.
 *
 * Order-independent on purpose: correctness shouldn't depend on the caller
 * remembering an `orderBy`.
 *
 * Throws when nothing is in force. A claim whose levy can't be determined is a
 * configuration fault, and defaulting to 0% would understate the money with no
 * signal. A plain Error, not an HttpException — mapping it to a 400 is the
 * controller's job, and this module stays framework-free.
 */
export function resolveLevyRate(rates: EffectiveRate[], expenseDate: Date): DecimalJs {
  let inForce: EffectiveRate | undefined;

  for (const rate of rates) {
    if (rate.effectiveFrom.getTime() > expenseDate.getTime()) continue;
    if (!inForce || rate.effectiveFrom.getTime() >= inForce.effectiveFrom.getTime()) {
      inForce = rate;
    }
  }

  if (!inForce) {
    throw new Error(
      `No surcharge rate in force for ${expenseDate.toISOString().slice(0, 10)}`,
    );
  }

  return new DecimalJs(inForce.ratePercent);
}
