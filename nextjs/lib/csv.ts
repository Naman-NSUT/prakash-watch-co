/**
 * Writing a spreadsheet the shop can open.
 *
 * Shared because there are now two exports — the accountant's reports and the
 * stock room's own list — and two copies of comma-escaping is two chances to
 * get it wrong in different ways.
 */

/** Quotes a field: doubles quotes, wraps anything with a comma or newline. */
export function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const toCsv = (rows: unknown[][]) => rows.map((row) => row.map(cell).join(",")).join("\r\n");

/**
 * A CSV response Excel opens correctly.
 *
 * The byte-order mark is not decoration: without it Excel reads UTF-8 as the
 * local code page, and a rupee sign or a brand's accent arrives as mojibake on
 * the shop's own screen.
 */
export function csvResponse(name: string, rows: unknown[][]): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${toCsv(rows)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${stamp}.csv"`,
    },
  });
}
