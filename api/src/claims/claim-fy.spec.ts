import { fyForDate, resolveLevyRate } from './claim-fy';

/** The rates the seed installs for every org (prisma/seed.ts:62-68). */
const SEEDED_RATES = [
  { ratePercent: 10, effectiveFrom: new Date('2024-07-01') },
  { ratePercent: 12.5, effectiveFrom: new Date('2026-01-01') },
];

describe('fyForDate', () => {
  describe('the 1 July boundary', () => {
    it('treats 30 June as the closing year of that FY', () => {
      expect(fyForDate(new Date('2026-06-30'))).toBe(26);
    });

    it('rolls to the next FY on 1 July', () => {
      expect(fyForDate(new Date('2026-07-01'))).toBe(27);
    });

    it('starts FY26 on 1 July 2025', () => {
      expect(fyForDate(new Date('2025-07-01'))).toBe(26);
    });

    it('keeps December in the FY that ends the following June', () => {
      expect(fyForDate(new Date('2026-12-31'))).toBe(27);
    });
  });

  describe("the brief's worked examples", () => {
    it('2026-02-10 -> FY26', () => {
      expect(fyForDate(new Date('2026-02-10'))).toBe(26);
    });

    it('2026-08-01 -> FY27', () => {
      expect(fyForDate(new Date('2026-08-01'))).toBe(27);
    });
  });

  describe('UTC safety', () => {
    /**
     * Expense dates are stored as UTC midnight. Reading them with local date
     * getters shifts the day either side of Greenwich, and the FY boundary is
     * exactly where that goes wrong. These two cases fail in opposite
     * hemispheres if the implementation ever slips to getMonth()/getFullYear():
     * the first breaks east of Greenwich, the second breaks west.
     */
    it('the last instant of FY26 is still FY26 (fails east of UTC on local getters)', () => {
      expect(fyForDate(new Date('2026-06-30T23:59:59.999Z'))).toBe(26);
    });

    it('the first instant of FY27 is already FY27 (fails west of UTC on local getters)', () => {
      expect(fyForDate(new Date('2026-07-01T00:00:00.000Z'))).toBe(27);
    });
  });

  describe('the two-digit contract', () => {
    it('wraps at the century so the reference format stays two digits', () => {
      expect(fyForDate(new Date('2099-08-01'))).toBe(0); // FY2100 -> "00"
    });

    it('never returns more than two digits', () => {
      for (const iso of ['2024-01-01', '2026-07-01', '2099-12-31']) {
        expect(fyForDate(new Date(iso))).toBeLessThan(100);
      }
    });
  });
});

describe('resolveLevyRate', () => {
  describe('against the seeded rates', () => {
    it('applies 10% before the 2026 change', () => {
      expect(resolveLevyRate(SEEDED_RATES, new Date('2025-12-31')).toString()).toBe('10');
    });

    it('applies 12.5% on the day the new rate takes effect', () => {
      // effectiveFrom is inclusive
      expect(resolveLevyRate(SEEDED_RATES, new Date('2026-01-01')).toString()).toBe('12.5');
    });

    it('applies 12.5% after the change', () => {
      expect(resolveLevyRate(SEEDED_RATES, new Date('2026-02-10')).toString()).toBe('12.5');
    });

    it('applies 10% on the day the first rate takes effect', () => {
      expect(resolveLevyRate(SEEDED_RATES, new Date('2024-07-01')).toString()).toBe('10');
    });

    it('resolves the rate for seeded claim EXP 26-0003 (2026-01-18) as 12.5%', () => {
      expect(resolveLevyRate(SEEDED_RATES, new Date('2026-01-18')).toString()).toBe('12.5');
    });
  });

  describe('ordering', () => {
    it('does not depend on the input being sorted', () => {
      const reversed = [...SEEDED_RATES].reverse();

      expect(resolveLevyRate(reversed, new Date('2025-12-31')).toString()).toBe('10');
      expect(resolveLevyRate(reversed, new Date('2026-02-10')).toString()).toBe('12.5');
    });

    it('picks the latest applicable rate when several are in the past', () => {
      const many = [
        { ratePercent: 5, effectiveFrom: new Date('2020-01-01') },
        { ratePercent: 12.5, effectiveFrom: new Date('2026-01-01') },
        { ratePercent: 10, effectiveFrom: new Date('2024-07-01') },
        { ratePercent: 99, effectiveFrom: new Date('2030-01-01') }, // future, must be ignored
      ];

      expect(resolveLevyRate(many, new Date('2026-06-30')).toString()).toBe('12.5');
    });
  });

  describe('when no rate is in force', () => {
    it('throws for an expense predating every rate', () => {
      expect(() => resolveLevyRate(SEEDED_RATES, new Date('2024-01-01'))).toThrow(
        /no surcharge rate/i,
      );
    });

    it('names the offending date in the message', () => {
      expect(() => resolveLevyRate(SEEDED_RATES, new Date('2024-01-01'))).toThrow(/2024-01-01/);
    });

    it('throws when no rates are configured at all', () => {
      expect(() => resolveLevyRate([], new Date('2026-02-10'))).toThrow(/no surcharge rate/i);
    });
  });

  describe('return type', () => {
    it('returns a Decimal, not a float', () => {
      const rate = resolveLevyRate(SEEDED_RATES, new Date('2026-02-10'));

      expect(typeof rate).toBe('object');
      expect(rate.toFixed(1)).toBe('12.5');
    });

    it('accepts a string ratePercent as Prisma Decimal columns would supply', () => {
      const rate = resolveLevyRate(
        [{ ratePercent: '12.5', effectiveFrom: new Date('2026-01-01') }],
        new Date('2026-02-10'),
      );

      expect(rate.toString()).toBe('12.5');
    });
  });

  describe('feeding Phase 1', () => {
    it('drives golden #1 end to end: the 2026-01-18 rate produces 67.47', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { computeTotals } = require('./claim-totals');
      const rate = resolveLevyRate(SEEDED_RATES, new Date('2026-01-18'));
      const totals = computeTotals([{ quantity: 3, unitPrice: '19.99', isFuel: true }], rate);

      expect(totals.total.toFixed(2)).toBe('67.47');
    });

    it('the same lines dated before the rate change total 65.97 at 10%', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { computeTotals } = require('./claim-totals');
      const rate = resolveLevyRate(SEEDED_RATES, new Date('2025-12-31'));
      const totals = computeTotals([{ quantity: 3, unitPrice: '19.99', isFuel: true }], rate);

      expect(totals.total.toFixed(2)).toBe('65.97');
    });
  });
});
