import { computeTotals } from './claim-totals';

/**
 * The brief states the golden examples to the cent, so every assertion compares
 * `.toFixed(2)` strings — a failure then reads as money rather than a Decimal dump.
 */
describe('computeTotals', () => {
  describe('golden examples from the brief (12.5%)', () => {
    it('#1: 3 x $19.99 fuel -> $67.47', () => {
      const result = computeTotals([{ quantity: 3, unitPrice: '19.99', isFuel: true }], 12.5);

      expect(result.fuelSubtotal.toFixed(2)).toBe('59.97');
      expect(result.nonFuelSubtotal.toFixed(2)).toBe('0.00');
      expect(result.levyAmount.toFixed(2)).toBe('7.50'); // 7.49625 rounded half-up
      expect(result.total.toFixed(2)).toBe('67.47');
    });

    it('#2: $1 + $1 fuel plus $5 non-fuel -> $7.25 (levy on the fuel subtotal only)', () => {
      const result = computeTotals(
        [
          { quantity: 1, unitPrice: '1.00', isFuel: true },
          { quantity: 1, unitPrice: '1.00', isFuel: true },
          { quantity: 1, unitPrice: '5.00', isFuel: false },
        ],
        12.5,
      );

      expect(result.fuelSubtotal.toFixed(2)).toBe('2.00');
      expect(result.nonFuelSubtotal.toFixed(2)).toBe('5.00');
      expect(result.levyAmount.toFixed(2)).toBe('0.25');
      expect(result.total.toFixed(2)).toBe('7.25');
    });

    it('#2 is not $7.875 — the levy must not touch the non-fuel subtotal', () => {
      const result = computeTotals(
        [
          { quantity: 1, unitPrice: '1.00', isFuel: true },
          { quantity: 1, unitPrice: '1.00', isFuel: true },
          { quantity: 1, unitPrice: '5.00', isFuel: false },
        ],
        12.5,
      );

      expect(result.total.toFixed(3)).not.toBe('7.875');
    });
  });

  describe('rounding', () => {
    it('rounds a half-cent up, not to-even', () => {
      // 0.04 fuel @ 12.5% = 0.005 exactly. Half-up -> 0.01; banker's rounding would give 0.00.
      const result = computeTotals([{ quantity: 1, unitPrice: '0.04', isFuel: true }], 12.5);

      expect(result.levyAmount.toFixed(2)).toBe('0.01');
      expect(result.total.toFixed(2)).toBe('0.05');
    });

    it('rounds a second half-cent up as well', () => {
      // 0.12 @ 12.5% = 0.015 -> 0.02. To-even would give 0.02 here too, so pair it with the case above.
      const result = computeTotals([{ quantity: 1, unitPrice: '0.12', isFuel: true }], 12.5);

      expect(result.levyAmount.toFixed(2)).toBe('0.02');
    });

    it('rounds below a half-cent down', () => {
      // 0.03 @ 12.5% = 0.00375 -> 0.00
      const result = computeTotals([{ quantity: 1, unitPrice: '0.03', isFuel: true }], 12.5);

      expect(result.levyAmount.toFixed(2)).toBe('0.00');
      expect(result.total.toFixed(2)).toBe('0.03');
    });
  });

  describe('levy scope', () => {
    it('applies no levy when there are no fuel lines', () => {
      const result = computeTotals(
        [
          { quantity: 2, unitPrice: '93.50', isFuel: false },
          { quantity: 1, unitPrice: '10.00' }, // isFuel omitted -> non-fuel
        ],
        12.5,
      );

      expect(result.fuelSubtotal.toFixed(2)).toBe('0.00');
      expect(result.nonFuelSubtotal.toFixed(2)).toBe('197.00');
      expect(result.levyAmount.toFixed(2)).toBe('0.00');
      expect(result.total.toFixed(2)).toBe('197.00');
    });

    it('levies the whole claim when every line is fuel', () => {
      const result = computeTotals(
        [
          { quantity: 2, unitPrice: '50.00', isFuel: true },
          { quantity: 1, unitPrice: '100.00', isFuel: true },
        ],
        12.5,
      );

      expect(result.fuelSubtotal.toFixed(2)).toBe('200.00');
      expect(result.nonFuelSubtotal.toFixed(2)).toBe('0.00');
      expect(result.levyAmount.toFixed(2)).toBe('25.00');
      expect(result.total.toFixed(2)).toBe('225.00');
    });

    it('applies the 10% rate in force before 2026-01-01', () => {
      const result = computeTotals([{ quantity: 3, unitPrice: '19.99', isFuel: true }], 10);

      expect(result.levyAmount.toFixed(2)).toBe('6.00'); // 5.997 -> 6.00
      expect(result.total.toFixed(2)).toBe('65.97');
    });

    it('applies a 0% rate as no levy at all', () => {
      const result = computeTotals([{ quantity: 3, unitPrice: '19.99', isFuel: true }], 0);

      expect(result.levyAmount.toFixed(2)).toBe('0.00');
      expect(result.total.toFixed(2)).toBe('59.97');
    });
  });

  describe('extremes', () => {
    it('handles a large value without losing cents', () => {
      const result = computeTotals([{ quantity: 1, unitPrice: '999999.99', isFuel: true }], 12.5);

      expect(result.fuelSubtotal.toFixed(2)).toBe('999999.99');
      expect(result.levyAmount.toFixed(2)).toBe('125000.00'); // 124999.99875 -> 125000.00
      expect(result.total.toFixed(2)).toBe('1124999.99');
    });

    it('handles the smallest unit price', () => {
      const result = computeTotals([{ quantity: 1, unitPrice: '0.01', isFuel: true }], 12.5);

      expect(result.fuelSubtotal.toFixed(2)).toBe('0.01');
      expect(result.levyAmount.toFixed(2)).toBe('0.00'); // 0.00125 -> 0.00
      expect(result.total.toFixed(2)).toBe('0.01');
    });

    it('handles a large quantity exactly: 10000 x 0.01 = 100.00', () => {
      const result = computeTotals([{ quantity: 10000, unitPrice: '0.01', isFuel: false }], 12.5);

      expect(result.nonFuelSubtotal.toFixed(2)).toBe('100.00');
      expect(result.total.toFixed(2)).toBe('100.00');
    });

    it('returns zeros for an empty claim', () => {
      const result = computeTotals([], 12.5);

      expect(result.fuelSubtotal.toFixed(2)).toBe('0.00');
      expect(result.nonFuelSubtotal.toFixed(2)).toBe('0.00');
      expect(result.levyAmount.toFixed(2)).toBe('0.00');
      expect(result.total.toFixed(2)).toBe('0.00');
    });
  });

  describe('exactness', () => {
    it('extends 7 x 13.37 to exactly 93.59, where float gives 93.58999999999999', () => {
      const result = computeTotals([{ quantity: 7, unitPrice: '13.37', isFuel: false }], 12.5);

      expect(result.nonFuelSubtotal.toString()).toBe('93.59');
      expect(7 * 13.37).not.toBe(93.59); // the trap this phase exists to avoid
    });

    it('keeps the golden #1 subtotal exact', () => {
      const result = computeTotals([{ quantity: 3, unitPrice: '19.99', isFuel: true }], 12.5);

      expect(result.fuelSubtotal.toString()).toBe('59.97');
    });

    it("does not reproduce the starter's float total of 67.46625", () => {
      // claims.service.ts rounds `59.97 * 1.125` — a single multiply over the whole
      // claim. It lands on 67.46625 and only survives golden #1 by luck of rounding.
      const result = computeTotals([{ quantity: 3, unitPrice: '19.99', isFuel: true }], 12.5);

      expect(59.97 * 1.125).toBe(67.46625);
      expect(result.total.toString()).toBe('67.47');
    });

    it('accepts a numeric unitPrice as well as a string', () => {
      const result = computeTotals([{ quantity: 3, unitPrice: 19.99, isFuel: true }], 12.5);

      expect(result.total.toFixed(2)).toBe('67.47');
    });
  });

  describe('invariant: the parts always sum to the total', () => {
    const cases: { name: string; lines: Parameters<typeof computeTotals>[0]; rate: number }[] = [
      { name: 'golden #1', lines: [{ quantity: 3, unitPrice: '19.99', isFuel: true }], rate: 12.5 },
      {
        name: 'golden #2',
        lines: [
          { quantity: 1, unitPrice: '1.00', isFuel: true },
          { quantity: 1, unitPrice: '1.00', isFuel: true },
          { quantity: 1, unitPrice: '5.00', isFuel: false },
        ],
        rate: 12.5,
      },
      { name: 'half-cent', lines: [{ quantity: 1, unitPrice: '0.04', isFuel: true }], rate: 12.5 },
      { name: 'no fuel', lines: [{ quantity: 2, unitPrice: '93.50', isFuel: false }], rate: 12.5 },
      { name: 'empty', lines: [], rate: 12.5 },
      { name: '10% rate', lines: [{ quantity: 7, unitPrice: '13.37', isFuel: true }], rate: 10 },
    ];

    it.each(cases)('$name: fuel + nonFuel + levy === total', ({ lines, rate }) => {
      const result = computeTotals(lines, rate);
      const summed = result.fuelSubtotal.plus(result.nonFuelSubtotal).plus(result.levyAmount);

      expect(summed.toFixed(2)).toBe(result.total.toFixed(2));
      expect(summed.equals(result.total)).toBe(true);
    });
  });
});
