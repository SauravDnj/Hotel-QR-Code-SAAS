/**
 * CSV for spreadsheet apps (Excel, Google Sheets, Numbers).
 * - Starts with a UTF-8 byte-order mark so Excel shows ₹, é, etc. correctly.
 * - Quotes fields containing commas, quotes or line breaks (RFC 4180), CRLF line endings.
 * - Guards against formula injection: text cells starting with = + - @ (or tab/CR) get a
 *   leading apostrophe, so guest-typed text can never run as a spreadsheet formula.
 *   Numbers are written as numbers and are not affected.
 */
export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
