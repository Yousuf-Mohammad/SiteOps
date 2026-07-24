/**
 * A small RFC 4180 reader.
 *
 * Exists because LegacyPlant exports quote their prices — `"1,299.50"` — and
 * `split(',')` turns a six-column row into seven fields with the money cut in
 * half. Handles quoted fields containing commas and newlines, `""` escapes,
 * CRLF, and a UTF-8 BOM on the first field.
 *
 * Rows carry the 1-based line number they started on, so error reports can
 * point at the line the operator sees in their spreadsheet. Blank lines are
 * skipped but still counted.
 */

export interface CsvRow {
  /** 1-based line in the source file, counting blank and continuation lines. */
  line: number;
  cells: string[];
}

const BOM = '﻿';

export function parseCsv(input: string): CsvRow[] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;

  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  /** Whether the current field was written as a quoted string. */
  let wasQuoted = false;
  let line = 1;
  let rowStartLine = 1;

  const endField = () => {
    // Unquoted fields are trimmed; quoted ones are taken literally, since the
    // quotes are how an author says "this whitespace is deliberate".
    cells.push(wasQuoted ? field : field.trim());
    field = '';
    wasQuoted = false;
  };

  const endRow = () => {
    endField();
    // A row of nothing but empty cells is blank as far as the caller cares.
    if (cells.some((c) => c !== '')) {
      rows.push({ line: rowStartLine, cells });
    }
    cells = [];
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field.trim() === '') {
      // Only opens a quoted field at the start of one; a stray quote mid-field
      // (`6" pipe`) is just a character.
      quoted = true;
      wasQuoted = true;
      field = '';
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n') {
      endRow();
      line++;
      rowStartLine = line;
    } else if (ch === '\r') {
      // Swallow the CR of a CRLF; the LF does the work.
    } else {
      field += ch;
    }
  }

  // Whatever is left after the last newline.
  if (field !== '' || cells.length > 0) endRow();

  return rows;
}
