import DecimalJs from 'decimal.js';

/**
 * Exact ex-GST claim totals — a deliberate, line-for-line MIRROR of
 * `api/src/claims/claim-totals.ts`.
 *
 * The server is authoritative; this copy exists only so the new-claim form can
 * show a live total that equals what the server will store. The two packages
 * don't share a build, so the file is duplicated and kept in step by hand. If
 * you change one, change the other — the parity check in the Phase 12
 * verification is what catches a drift. (Risk-log row 14.)
 *
 * The rate is NOT resolved here. The form passes the current levy rate; see the
 * note on the hardcoded rate in `app/claims/new/page.tsx`.
 */

/** Half-up to the cent, scoped to this module so the setting can't leak in or out. */
const Decimal = DecimalJs.clone({ rounding: DecimalJs.ROUND_HALF_UP });

const CENTS = 2;

export interface ClaimTotalLine {
  quantity: number;
  unitPrice: DecimalJs.Value;
  /** Fuel lines, and only fuel lines, attract the levy. Omitted means non-fuel. */
  isFuel?: boolean;
}

export interface ClaimTotals {
  fuelSubtotal: DecimalJs;
  nonFuelSubtotal: DecimalJs;
  levyAmount: DecimalJs;
  total: DecimalJs;
}

/**
 * The levy applies once, to the fuel subtotal — never per line, never to the
 * whole claim. Rounding happens at one place: the levy, before summing, so the
 * four amounts add up exactly. See the API original for the full reasoning.
 */
export function computeTotals(
  lines: ClaimTotalLine[],
  levyRatePercent: DecimalJs.Value,
): ClaimTotals {
  let fuelSubtotal = new Decimal(0);
  let nonFuelSubtotal = new Decimal(0);

  for (const line of lines) {
    const lineTotal = new Decimal(line.unitPrice).times(line.quantity);
    if (line.isFuel) {
      fuelSubtotal = fuelSubtotal.plus(lineTotal);
    } else {
      nonFuelSubtotal = nonFuelSubtotal.plus(lineTotal);
    }
  }

  const levyAmount = fuelSubtotal
    .times(levyRatePercent)
    .div(100)
    .toDecimalPlaces(CENTS, DecimalJs.ROUND_HALF_UP);

  return {
    fuelSubtotal,
    nonFuelSubtotal,
    levyAmount,
    total: fuelSubtotal.plus(nonFuelSubtotal).plus(levyAmount),
  };
}
