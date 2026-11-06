// S-12 "My reservations" (D-005): the tokens of this device's bookings, newest first, in localStorage. Tokens only: no
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

const link = (token: string, text: string, testid: string): HTMLAnchorElement => {
  const a = el("a", text, "my-link", testid);
  a.href = `#/b/${encodeURIComponent(token)}`;
  return a;
};

/** The header link(s) for the saved list, or an empty list of children when nothing valid is saved. */
export function savedNav(): HTMLElement[] {
  const tokens = readSaved();
  if (tokens.length === 0) return [];
  const out: HTMLElement[] = [link(tokens[0]!, "My reservations", "my-reservations")];
  if (tokens.length > 1) {
    const ul = el("ul", undefined, "my-list");
    ul.setAttribute("role", "list");
    tokens.forEach((t, i) => {
      const li = el("li");
      li.append(link(t, i === 0 ? "Reservation 1 (newest)" : `Reservation ${i + 1}`, "my-reservations-item"));
      ul.append(li);
    });
    out.push(ul);
  }
  return out;
}
