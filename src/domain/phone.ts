// Buyer phone normalisation (brief 6.3). Pure: no platform code, never throws.

/** Formatting people type between digits; ignored. */
const FORMATTING = /[\s\-.()]/g;

/**
 * Returns the E.164 form ("+" then 8 to 15 digits, first digit not 0), or null.
 * - Exactly 10 digits and no "+": India, so "+91" is prefixed.
 * - A leading "+": the rest must be a plausible international number (no country
 *   code starts with 0, E.164 allows at most 15 digits). Eight digits is our floor:
 *   shorter is far more likely a typo than a real number.
 * - A trunk 0 after "+91", or at the start of ten digits, is refused (D-036).
 * - Everything else is refused rather than guessed at (a "0..." national form, "91..."
 *   typed without the "+", letters, a "+" anywhere but the start, non-strings).
 * Unlike D-036 (the seller's number, +91 must be followed by exactly 10 digits),
 * a buyer's "+91" number is not length-checked beyond the generic rules.
 */
export function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(FORMATTING, "");
  // A trunk 0 ("0" + 10 digits, or "+91" then 0) is a national dialling prefix, not part of the
  // number: refuse it rather than store an invalid E.164 (QA F7, same rule as D-036).
  if (/^\+910/.test(s)) return null;
  if (/^\d{10}$/.test(s)) return s.startsWith("0") ? null : `+91${s}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
