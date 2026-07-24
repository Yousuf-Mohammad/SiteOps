import { parseCsv } from './csv';

describe('parseCsv', () => {
  describe('the quoted-comma trap', () => {
    it('keeps a comma inside quotes as part of the value', () => {
      // The whole reason this parser exists: split(',') turns this into 4 fields.
      const rows = parseCsv('a,"1,299.50",c');

      expect(rows[0].cells).toEqual(['a', '1,299.50', 'c']);
    });

    it('handles several quoted values on one line', () => {
      const rows = parseCsv('"1,000.00","2,500.75",plain');

      expect(rows[0].cells).toEqual(['1,000.00', '2,500.75', 'plain']);
    });

    it('does not treat quotes in the middle of a bare field as quoting', () => {
      const rows = parseCsv('6" pipe,2');

      expect(rows[0].cells).toEqual(['6" pipe', '2']);
    });
  });

  describe('quoting rules', () => {
    it('unescapes a doubled quote inside a quoted field', () => {
      const rows = parseCsv('a,"He said ""hi""",c');

      expect(rows[0].cells).toEqual(['a', 'He said "hi"', 'c']);
    });

    it('keeps a newline inside a quoted field', () => {
      const rows = parseCsv('a,"line one\nline two",c');

      expect(rows).toHaveLength(1);
      expect(rows[0].cells[1]).toBe('line one\nline two');
    });

    it('handles an empty quoted field', () => {
      const rows = parseCsv('a,"",c');

      expect(rows[0].cells).toEqual(['a', '', 'c']);
    });

    it('handles a field that is only a quoted comma', () => {
      const rows = parseCsv('a,",",c');

      expect(rows[0].cells).toEqual(['a', ',', 'c']);
    });
  });

  describe('line endings and whitespace', () => {
    it('splits on LF', () => {
      const rows = parseCsv('a,b\nc,d');

      expect(rows.map((r) => r.cells)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('splits on CRLF without leaving carriage returns behind', () => {
      const rows = parseCsv('a,b\r\nc,d');

      expect(rows.map((r) => r.cells)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('strips a UTF-8 BOM from the first field', () => {
      const rows = parseCsv('﻿expense_date,description');

      expect(rows[0].cells[0]).toBe('expense_date');
    });

    it('trims surrounding whitespace on unquoted fields', () => {
      const rows = parseCsv('a , b ,c');

      expect(rows[0].cells).toEqual(['a', 'b', 'c']);
    });

    it('preserves whitespace inside quotes', () => {
      const rows = parseCsv('" padded ",b');

      expect(rows[0].cells[0]).toBe(' padded ');
    });

    it('tolerates a trailing newline', () => {
      const rows = parseCsv('a,b\nc,d\n');

      expect(rows).toHaveLength(2);
    });
  });

  describe('blank rows', () => {
    it('skips entirely blank lines', () => {
      const rows = parseCsv('a,b\n\nc,d');

      expect(rows.map((r) => r.cells)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('skips whitespace-only lines', () => {
      const rows = parseCsv('a,b\n   \nc,d');

      expect(rows).toHaveLength(2);
    });

    it('returns nothing for an empty input', () => {
      expect(parseCsv('')).toEqual([]);
      expect(parseCsv('   \n  \n')).toEqual([]);
    });
  });

  describe('line numbers', () => {
    it('reports the 1-based line number an operator would see', () => {
      const rows = parseCsv('header\nfirst\nsecond');

      expect(rows.map((r) => r.line)).toEqual([1, 2, 3]);
    });

    it('counts skipped blank lines so numbers still match the file', () => {
      const rows = parseCsv('header\n\nsecond');

      expect(rows.map((r) => r.line)).toEqual([1, 3]);
    });

    it('counts a newline inside a quoted field toward later line numbers', () => {
      const rows = parseCsv('header\n"multi\nline",x\nlast');

      expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
    });
  });

  describe('ragged input', () => {
    it('does not pad or truncate short rows — the caller decides', () => {
      const rows = parseCsv('a,b,c\nd,e');

      expect(rows[1].cells).toEqual(['d', 'e']);
    });

    it('keeps a trailing empty field', () => {
      const rows = parseCsv('a,b,');

      expect(rows[0].cells).toEqual(['a', 'b', '']);
    });
  });

  describe('the real LegacyPlant shape', () => {
    it('parses a row with a quoted thousands-separated price', () => {
      const csv = [
        'expense_date,description,quantity,unit_price,is_fuel,group',
        '2026-02-10,"Excavator hire, weekly",1,"1,299.50",false,G1',
      ].join('\n');

      const rows = parseCsv(csv);

      expect(rows[1].cells).toEqual([
        '2026-02-10',
        'Excavator hire, weekly',
        '1',
        '1,299.50',
        'false',
        'G1',
      ]);
    });
  });
});
