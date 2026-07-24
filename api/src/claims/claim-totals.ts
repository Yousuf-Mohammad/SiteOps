import DecimalJs from 'decimal.js';

/**
 * Exact ex-GST claim totals.
 *
 * Pure and framework-free on purpose — no Prisma, no Nest, no clock, no rate
 * lookup. Resolving *which* levy rate applies to an expense date is the
 * caller's job (see the effective-dated resolver); this function is handed the
 * rate and does arithmetic.
 *
 * Money is Decimal throughout. `3 * 19.99` is 59.970000000000006 in binary
 * floating point, which cannot satisfy the brief's "exact to the cent".
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
 * The levy applies **once, to the fuel subtotal** — never per line, never to
 * the whole claim. Applying it per line would still pass the 3 x $19.99
 * example and silently fail $1 + $1 + $5, which is exactly what that second
 * golden example is there to catch.
 *
 * Rounding happens at one place: the levy. Line extensions are exact (integer
 * quantity x a 2dp price), so nothing else needs it. Rounding the levy
 * *before* summing — rather than rounding the total afterwards — is what makes
 * the four returned amounts add up exactly, which matters once they are stored
 * as separate columns on the claim and someone has to check the arithmetic.
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
