// S-12 "My reservations" (D-005; S-19 made it one page): the tokens of this device's bookings, newest first, in localStorage. Tokens only: no
// names and no numbers are ever stored here. Every access is guarded (blocked or corrupt storage, T-14).
import { el } from "./dom";

const BOOKINGS_KEY = "medley-sale:bookings:v1";

/** The saved tokens, newest first. Junk (not JSON, not an array, non-strings, empty strings, repeats) is skipped. */
export function readSaved(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BOOKINGS_KEY) ?? "null");
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((t): t is string => typeof t === "string" && t.length > 0))];
  } catch {
    return [];
  }
}

/** Puts a token at the front of the list; one already there moves to the front rather than being listed twice. */
export function saveBooking(token: string): void {
  try {
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify([token, ...readSaved().filter((t) => t !== token)]));
  } catch {
    /* blocked or full: the booking is still on the server and in the buyer's private link */
  }
}

/** The header link for the saved list (S-19: one page, #/mine, for every booking), or none when nothing valid is saved. */
export function savedNav(): HTMLElement[] {
  if (readSaved().length === 0) return [];
  const a = el("a", "My reservations", "my-link", "my-reservations");
  a.href = "#/mine";
  return [a];
}

/** Drops a token from the saved list (the booking API said it no longer exists). Others keep their order. */
export function forgetBooking(token: string): void {
  try {
    const all = readSaved();
    if (!all.includes(token)) return; // never saved here: a mistyped link leaves the list alone
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(all.filter((t) => t !== token)));
  } catch {
    /* blocked storage: the stale link stays, nothing else breaks */
  }
}
