// S-13: records that a buyer's browser went to WhatsApp (brief 4.3: "Records `WhatsApp opened` where possible").
// Best effort and one cell: the first time goes in the Bookings row's "WhatsApp opened" cell and a repeat leaves it
// alone. It never touches a claim, an item or another booking, and answers nothing about anyone.
//
// Takes the script lock like every writer (6.1 rule 6). The token check needs no lock, but it is the Bookings read, so
// anything that is not a string is refused before any lock or read. Every miss answers the same bytes (T-11).
import { findBooking } from "./booking";
import { text, unapostrophe } from "./cell-text";
import { colOf } from "./migrate";
import { locked, type SellerDeps } from "./seller-sheet";
import type { Spreadsheet } from "./sheet";

export type WaOpenedResponse =
  | { ok: true }
  | { ok: false; error: "not-found" | "not-reserving" | "busy" };

const BOOKINGS = "Bookings";
const NOT_FOUND = { ok: false, error: "not-found" } as const;

export function waOpened(ss: Spreadsheet, request: unknown, deps: SellerDeps): WaOpenedResponse {
  const token = typeof request === "object" && request !== null && !Array.isArray(request) ? (request as { token?: unknown }).token : undefined;
  if (typeof token !== "string" || token === "") return NOT_FOUND;
  if (!ss.getTab(BOOKINGS)) return { ok: false, error: "not-reserving" }; // status mode (D-038.6)

  const out = locked(ss, deps, (markWrote): WaOpenedResponse => {
    // Read under the lock: a sort or a concurrent reserve may have moved the row since any earlier look.
    const tab = ss.getTab(BOOKINGS)!;
    if (!findBooking(ss, token)) return NOT_FOUND;
    const grid = tab.getGrid();
    const head = grid[0] ?? [];
    const tokenCol = colOf(head, "Token"), openedCol = colOf(head, "WhatsApp opened");
    if (!openedCol) return { ok: true }; // "where possible": no column, nothing to record
    const i = grid.findIndex((r, n) => n > 0 && text(r[tokenCol - 1]) !== null && unapostrophe(text(r[tokenCol - 1])!) === token);
    if (i < 0) return NOT_FOUND;
    if (text(grid[i]![openedCol - 1]) !== null) return { ok: true }; // the first time stands
    markWrote();
    tab.setCell(i + 1, openedCol, deps.now());
    return { ok: true };
  }, false); // a Bookings stamp cannot change the catalogue, so the cache stays
  return out.busy ? { ok: false, error: "busy" } : out.value;
}
