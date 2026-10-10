/**
 * Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, commas and line breaks inside quotes,
 * CRLF or LF, optional UTF-8 BOM. Pure, no dependencies.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    // A completely empty line is not a record.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const char = source[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (source[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
    }
    i += 1;
  }
  if (inQuotes) {
    throw new Error('CSV ends inside a quoted field');
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}
