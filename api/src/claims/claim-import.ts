import { CsvRow, parseCsv } from './csv';

/**
 * Turns a LegacyPlant CSV into claim-shaped groups, or reasons why not.
 *
 * Pure: no Prisma, no Nest. The caller creates the valid groups and reports the
 * invalid ones. Validation is per *group*, because the brief makes import
 * best-effort per claim — one bad line rejects that claim and nothing else.
 */

export const REQUIRED_HEADERS = [
  'expense_date',
  'description',
  'quantity',
  'unit_price',
  'is_fuel',
  'group',
] as const;

export interface ImportLine {
  description: string;
  quantity: number;
  unitPrice: number;
  isFuel: boolean;
}

export interface ImportGroup {
  group: string;
  expenseDate: string;
  lines: ImportLine[];
  /** Source line numbers, for reporting. */
  rows: number[];
}

export interface ImportRejection {
  group: string;
  rows: number[];
  reason: string;
}

export interface ImportPlan {
  groups: ImportGroup[];
  rejected: ImportRejection[];
}

/** Thrown for problems that make the whole file unusable, not one claim. */
export class CsvFormatError extends Error {}

const TRUE_WORDS = new Set(['true', 't', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'f', 'no', 'n', '0', '']);

/** `"1,299.50"` -> 1299.5. Thousands separators are display, not data. */
function parseMoney(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`unit_price "${raw}" is not a positive amount with at most 2 decimal places`);
  }
  const value = Number(cleaned);
  if (!(value > 0)) throw new Error(`unit_price "${raw}" must be greater than zero`);
  return value;
}

function parseQuantity(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(`quantity "${raw}" is not a whole number`);
  }
  const value = Number(cleaned);
  if (value < 1) throw new Error(`quantity "${raw}" must be at least 1`);
  return value;
}

function parseFuel(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  throw new Error(`is_fuel "${raw}" is not a yes/no value`);
}

function parseDate(raw: string): string {
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new Error(`expense_date "${raw}" is not a valid YYYY-MM-DD date`);
  }
  return v;
}

/**
 * @throws CsvFormatError when the file itself is unusable (no rows, bad headers).
 */
export function planImport(csv: string): ImportPlan {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new CsvFormatError('The CSV is empty');

  // Headers may arrive in any order — only their presence is required.
  const header = rows[0].cells.map((c) => c.trim().toLowerCase());
  const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw new CsvFormatError(`Missing required column(s): ${missing.join(', ')}`);
  }
  const at = (row: CsvRow, name: string) => row.cells[header.indexOf(name)] ?? '';

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) throw new CsvFormatError('The CSV has headers but no rows');

  // Group in encounter order. Rows sharing a group form one claim even when
  // they are not adjacent — same group means same claim.
  const order: string[] = [];
  const byGroup = new Map<string, CsvRow[]>();
  const ungrouped: number[] = [];

  for (const row of dataRows) {
    const group = at(row, 'group').trim();
    if (group === '') {
      ungrouped.push(row.line);
      continue;
    }
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      order.push(group);
    }
    byGroup.get(group)!.push(row);
  }

  const groups: ImportGroup[] = [];
  const rejected: ImportRejection[] = [];

  if (ungrouped.length > 0) {
    rejected.push({ group: '', rows: ungrouped, reason: 'Row has no group' });
  }

  for (const group of order) {
    const groupRows = byGroup.get(group)!;
    const rowNumbers = groupRows.map((r) => r.line);

    try {
      const dates = new Set(groupRows.map((r) => parseDate(at(r, 'expense_date'))));
      if (dates.size > 1) {
        // One claim has one expense date; quietly picking the first would
        // invent data, and the FY and levy rate both hang off it.
        throw new Error(
          `rows disagree on expense_date (${[...dates].sort().join(', ')})`,
        );
      }

      const lines: ImportLine[] = groupRows.map((r) => {
        const description = at(r, 'description').trim();
        if (description === '') throw new Error(`row ${r.line}: description is empty`);
        try {
          return {
            description,
            quantity: parseQuantity(at(r, 'quantity')),
            unitPrice: parseMoney(at(r, 'unit_price')),
            isFuel: parseFuel(at(r, 'is_fuel')),
          };
        } catch (err) {
          throw new Error(`row ${r.line}: ${(err as Error).message}`);
        }
      });

      groups.push({ group, expenseDate: [...dates][0], lines, rows: rowNumbers });
    } catch (err) {
      // One bad line rejects its whole claim — and only that claim.
      rejected.push({ group, rows: rowNumbers, reason: (err as Error).message });
    }
  }

  return { groups, rejected };
}
