import { CsvFormatError, planImport } from './claim-import';

const HEADER = 'expense_date,description,quantity,unit_price,is_fuel,group';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('planImport', () => {
  describe('whole-file failures', () => {
    it('rejects an empty file', () => {
      expect(() => planImport('')).toThrow(CsvFormatError);
    });

    it('rejects headers with no rows', () => {
      expect(() => planImport(HEADER)).toThrow(/no rows/i);
    });

    it('names every missing column', () => {
      expect(() => planImport('expense_date,description\n2026-01-18,x')).toThrow(
        /missing required column\(s\): quantity, unit_price, is_fuel, group/i,
      );
    });

    it('accepts headers in any order', () => {
      const reordered = [
        'group,is_fuel,unit_price,quantity,description,expense_date',
        'G1,false,10.00,2,Cones,2026-01-18',
      ].join('\n');

      const plan = planImport(reordered);

      expect(plan.groups).toHaveLength(1);
      expect(plan.groups[0].lines[0]).toMatchObject({ description: 'Cones', quantity: 2 });
    });

    it('tolerates a UTF-8 BOM on the first header', () => {
      const plan = planImport('﻿' + csv('2026-01-18,Cones,1,10.00,false,G1'));

      expect(plan.groups).toHaveLength(1);
    });
  });

  describe('the quoted price', () => {
    it('parses "1,299.50" as 1299.50', () => {
      const plan = planImport(csv('2026-01-18,"Excavator hire",1,"1,299.50",false,G1'));

      expect(plan.groups[0].lines[0].unitPrice).toBe(1299.5);
    });

    it('parses a description containing a comma without shifting columns', () => {
      const plan = planImport(csv('2026-01-18,"Excavator hire, weekly",2,"1,000.00",false,G1'));

      expect(plan.groups[0].lines[0]).toMatchObject({
        description: 'Excavator hire, weekly',
        quantity: 2,
        unitPrice: 1000,
      });
    });
  });

  describe('grouping', () => {
    it('collects rows sharing a group into one claim', () => {
      const plan = planImport(
        csv('2026-01-18,A,1,10.00,true,G1', '2026-01-18,B,2,5.00,false,G1'),
      );

      expect(plan.groups).toHaveLength(1);
      expect(plan.groups[0].lines).toHaveLength(2);
    });

    it('collects non-contiguous rows of the same group', () => {
      const plan = planImport(
        csv(
          '2026-01-18,A,1,10.00,true,G1',
          '2026-02-10,X,1,20.00,false,G2',
          '2026-01-18,B,1,5.00,false,G1',
        ),
      );

      expect(plan.groups.map((g) => g.group)).toEqual(['G1', 'G2']);
      expect(plan.groups[0].lines.map((l) => l.description)).toEqual(['A', 'B']);
    });

    it('keeps groups in the order first seen', () => {
      const plan = planImport(
        csv('2026-01-18,A,1,1.00,false,Z', '2026-01-18,B,1,1.00,false,A'),
      );

      expect(plan.groups.map((g) => g.group)).toEqual(['Z', 'A']);
    });

    it('reports rows with no group rather than silently dropping them', () => {
      const plan = planImport(
        csv('2026-01-18,A,1,10.00,false,G1', '2026-01-18,Orphan,1,5.00,false,'),
      );

      expect(plan.groups).toHaveLength(1);
      expect(plan.rejected).toContainEqual({ group: '', rows: [3], reason: 'Row has no group' });
    });
  });

  describe('best-effort: one bad line rejects only its own claim', () => {
    it('creates the good group and reports the bad one with row numbers', () => {
      const plan = planImport(
        csv(
          '2026-01-18,Good A,1,10.00,true,G1',
          '2026-01-18,Bad,notanumber,10.00,false,G2',
          '2026-01-18,Good B,2,5.00,false,G1',
        ),
      );

      expect(plan.groups.map((g) => g.group)).toEqual(['G1']);
      expect(plan.rejected).toHaveLength(1);
      expect(plan.rejected[0]).toMatchObject({ group: 'G2', rows: [3] });
      expect(plan.rejected[0].reason).toMatch(/quantity "notanumber" is not a whole number/);
    });

    it('rejects the whole group when only one of its lines is bad', () => {
      const plan = planImport(
        csv('2026-01-18,Fine,1,10.00,false,G1', '2026-01-18,Broken,1,-5.00,false,G1'),
      );

      expect(plan.groups).toHaveLength(0);
      expect(plan.rejected[0].rows).toEqual([2, 3]);
      expect(plan.rejected[0].reason).toMatch(/row 3/);
    });

    it('reports each bad group separately', () => {
      const plan = planImport(
        csv(
          '2026-01-18,A,0,10.00,false,G1',
          '2026-01-18,B,1,abc,false,G2',
          '2026-01-18,C,1,10.00,false,G3',
        ),
      );

      expect(plan.groups.map((g) => g.group)).toEqual(['G3']);
      expect(plan.rejected.map((r) => r.group)).toEqual(['G1', 'G2']);
    });
  });

  describe('field validation', () => {
    const bad = (row: string) => planImport(csv(row)).rejected[0].reason;

    it('rejects a non-date expense_date', () => {
      expect(bad('18/01/2026,A,1,10.00,false,G1')).toMatch(/not a valid YYYY-MM-DD date/);
    });

    it('rejects an impossible date', () => {
      expect(bad('2026-13-45,A,1,10.00,false,G1')).toMatch(/not a valid YYYY-MM-DD date/);
    });

    it('rejects an empty description', () => {
      expect(bad('2026-01-18,,1,10.00,false,G1')).toMatch(/description is empty/);
    });

    it('rejects a fractional quantity', () => {
      expect(bad('2026-01-18,A,1.5,10.00,false,G1')).toMatch(/not a whole number/);
    });

    it('rejects a zero quantity', () => {
      expect(bad('2026-01-18,A,0,10.00,false,G1')).toMatch(/at least 1/);
    });

    it('rejects a price with three decimal places', () => {
      expect(bad('2026-01-18,A,1,10.005,false,G1')).toMatch(/at most 2 decimal places/);
    });

    it('rejects a negative price', () => {
      expect(bad('2026-01-18,A,1,-10.00,false,G1')).toMatch(/not a positive amount/);
    });

    it('rejects an unrecognised is_fuel value', () => {
      expect(bad('2026-01-18,A,1,10.00,maybe,G1')).toMatch(/not a yes\/no value/);
    });

    it('accepts common truthy and falsy spellings of is_fuel', () => {
      const plan = planImport(
        csv(
          '2026-01-18,A,1,1.00,TRUE,G1',
          '2026-01-18,B,1,1.00,Yes,G1',
          '2026-01-18,C,1,1.00,1,G1',
          '2026-01-18,D,1,1.00,no,G1',
          '2026-01-18,E,1,1.00,,G1',
        ),
      );

      expect(plan.groups[0].lines.map((l) => l.isFuel)).toEqual([true, true, true, false, false]);
    });
  });

  describe('one claim, one expense date', () => {
    it('rejects a group whose rows disagree on expense_date', () => {
      const plan = planImport(
        csv('2026-01-18,A,1,10.00,false,G1', '2026-02-10,B,1,10.00,false,G1'),
      );

      expect(plan.groups).toHaveLength(0);
      expect(plan.rejected[0].reason).toMatch(/disagree on expense_date \(2026-01-18, 2026-02-10\)/);
    });

    it('accepts a group whose rows all share one date', () => {
      const plan = planImport(
        csv('2026-01-18,A,1,10.00,false,G1', '2026-01-18,B,1,10.00,false,G1'),
      );

      expect(plan.groups[0].expenseDate).toBe('2026-01-18');
    });
  });

  describe('blank rows', () => {
    it('skips them without disturbing the line numbers reported', () => {
      const plan = planImport(
        [HEADER, '', '2026-01-18,A,1,10.00,false,G1', '   ', '2026-01-18,B,x,10.00,false,G2'].join(
          '\n',
        ),
      );

      expect(plan.groups[0].rows).toEqual([3]);
      expect(plan.rejected[0].rows).toEqual([5]);
    });
  });
});
