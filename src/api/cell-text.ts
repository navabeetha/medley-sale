// Small readers for sheet cells, shared by the handlers in src/api (reserve, seller sheet workflow).

import type { CellValue } from "./sheet";

/** A cell as trimmed text, or null when it is blank. */
export const text = (v: CellValue | undefined): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? null : s;
};
/** Undo guardText (6.3) for reading back what we wrote. (Real Sheets drops the apostrophe itself.) */
export const unguard = (s: string): string => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);
/**
 * Strips ONE leading apostrophe. Token, Idempotency key and Number are always written with one
 * (QA F9: Sheets must never re-type an all-digit token as a number); real Sheets drops it on read,
 * the fake keeps it, so readers accept both.
 */
export const unapostrophe = (s: string): string => (s.startsWith("'") ? s.slice(1) : s);
/**
 * A Number cell as text. Sheets re-types a typed "+919000000012" as the number 919000000012 and drops
 * the "+" (S-15 QA F4), so a numeric cell of exactly 12 digits starting 91 is read as "+91...". Every
 * other cell reads as `text`; normalisePhone is deliberately unchanged for text.
 */
export const numberText = (v: CellValue | undefined): string | null =>
  typeof v === "number" && Number.isInteger(v) && /^91\d{10}$/.test(String(v)) ? `+${v}` : text(v);
