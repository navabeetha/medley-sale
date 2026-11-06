// S-12: the booking API (brief 2.7, 4.3, 6.1 rule 8, 6.4; D-005, D-009, D-011). One buyer's private page: what they
// hold, wait for, bought and gave up, found by the token in the POST body.
//
// Read-only and WITHOUT the script lock, on purpose: it writes nothing, flushes nothing and never clears the cache, and
// every writer flushes before it releases the lock, so a page view sees the sheet before or after a change. Taking the
// lock for a read would let a page view answer "busy" and slow a reserve down.
//
// Privacy (D-009, D-011): the answer carries this booking's own claims only. It never reads the Number column, other
// buyers' rows or any other token, and has no row numbers; the seller's number appears only inside whatsappUrl.
import { contactUrl } from "./catalogue";
import { text, unguard, unapostrophe } from "./cell-text";
import { colOf } from "./migrate";
import { CLAIMS, readClaims, readItems, toInput, itemInput, type ClaimRow, type ItemRow } from "./seller-sheet";
import type { Spreadsheet } from "./sheet";
import { cleanSiteUrl } from "./site-url";
import { buildMessage, type MessageUnit } from "../domain/message";
import { recalculate, type ClaimResult } from "../domain/queue";

export interface BookingDeps {
  /** ISO timestamp; only handed to the queue, which is run read-only. */
  now: () => string;
  /** Script Property SITE_URL, for the private link inside whatsappUrl (reserve's rule). */
  siteUrl: string;
  /** Script Property SELLER_WHATSAPP (contactUrl rules, D-036). */
  sellerWhatsapp?: string;
}

export type Line = {
  itemId: string;
  name: string;
  detail: string | null;
  isBook: boolean;
  quantity: number;
  claimIds: number[];
};
export type WaitingLine = {
  claimId: number;
  itemId: string;
  name: string;
  detail: string | null;
  isBook: boolean;
  position: number;
  /** The item is sold out and this claim is still active (6.1.8: "This item was sold"). */
  itemSold: boolean;
};
/** A type alias, not an interface, so callers can treat the view as a plain record. */
export type BookingView = {
  bookingId: number;
  name: string;
  reserved: Line[];
  waiting: WaitingLine[];
  sold: Line[];
  ended: Line[];
};
export type BookingResponse =
  | { ok: true; booking: BookingView; whatsappUrl: string | null }
  | { ok: false; error: "not-found" | "not-reserving" };

const BOOKINGS = "Bookings";
const NOT_FOUND = { ok: false, error: "not-found" } as const;

/**
 * The booking a token belongs to, or null. ONE answer for every kind of miss (a non-string, empty or odd token, or a
 * blank Token cell), so the format of a token is never hinted (T-11). The stored token has a leading apostrophe (QA F9)
 * that real Sheets drops on read, so ONE is stripped from the stored value only; the request is compared as given.
 * Not constant-time: a 128-bit random token is not guessable by timing in Apps Script's latency.
 */
export function findBooking(ss: Spreadsheet, token: unknown): { id: number; name: string } | null {
  if (typeof token !== "string" || token === "") return null;
  const grid = ss.getTab(BOOKINGS)?.getGrid() ?? [];
  const head = grid[0] ?? [];
  const idCol = colOf(head, "Booking ID"), tokenCol = colOf(head, "Token"), nameCol = colOf(head, "Name");
  if (!idCol || !tokenCol) return null;
  for (const r of grid.slice(1)) {
    const stored = text(r[tokenCol - 1]);
    const id = text(r[idCol - 1]);
    if (stored === null || id === null || !Number.isFinite(Number(id)) || unapostrophe(stored) !== token) continue;
    return { id: Number(id), name: nameCol ? unguard(text(r[nameCol - 1]) ?? "") : "" };
  }
  return null;
}

/** One line per item, however many units; lines ordered by their lowest claim ID (claims arrive in ID order). */
function group(claims: ClaimRow[], items: Map<string, ItemRow>): Line[] {
  const lines = new Map<string, Line>();
  for (const c of claims) {
    const item = items.get(c.itemId)!;
    const line = lines.get(c.itemId);
    if (line) { line.claimIds.push(c.claimId); line.quantity++; }
    else lines.set(c.itemId, { itemId: item.id, name: item.name, detail: item.detail, isBook: item.isBook, quantity: 1, claimIds: [c.claimId] });
  }
  return [...lines.values()];
}

export function booking(ss: Spreadsheet, request: unknown, deps: BookingDeps): BookingResponse {
  const claimsTab = ss.getTab(CLAIMS);
  if (!claimsTab || !ss.getTab(BOOKINGS)) return { ok: false, error: "not-reserving" }; // status mode (D-038.6)
  const token = typeof request === "object" && request !== null && !Array.isArray(request) ? (request as { token?: unknown }).token : undefined;
  const found = findBooking(ss, token);
  if (!found) return NOT_FOUND;

  const items = readItems(ss);
  const all = readClaims(claimsTab).rows.sort((a, b) => a.claimId - b.claimId);
  const now = deps.now();
  // Each item's queue, run read-only (previousRole null: nobody is stamped here).
  const results = new Map<number, ClaimResult>();
  for (const item of items.values()) {
    const own = all.filter((c) => c.itemId === item.id);
    if (own.length === 0) continue;
    for (const r of recalculate(itemInput(item), own.map((c) => toInput(c, null)), now).claims) results.set(r.claimId, r);
  }

  const mine = all.filter((c) => c.bookingId === found.id && items.has(c.itemId));
  const roleOf = (c: ClaimRow) => results.get(c.claimId)!;
  const holding = mine.filter((c) => c.state === "active" && roleOf(c).role === "holder");
  const waitingClaims = mine.filter((c) => c.state === "active" && roleOf(c).role === "waiting");
  const view: BookingView = {
    bookingId: found.id,
    name: found.name,
    reserved: group(holding, items),
    waiting: waitingClaims.map((c) => {
      const item = items.get(c.itemId)!, r = roleOf(c);
      return { claimId: c.claimId, itemId: item.id, name: item.name, detail: item.detail, isBook: item.isBook, position: r.position ?? 1, itemSold: r.itemSold };
    }),
    sold: group(mine.filter((c) => c.state === "sold"), items),
    ended: group(mine.filter((c) => c.state === "released"), items),
  };

  // The buyer's message to the seller for what they hold or wait for now; sold and ended items are left out.
  const base = contactUrl(deps.sellerWhatsapp);
  const siteUrl = cleanSiteUrl(deps.siteUrl);
  let whatsappUrl: string | null = null;
  if (base && siteUrl && (holding.length > 0 || waitingClaims.length > 0)) {
    const unit = (c: ClaimRow): MessageUnit => {
      const item = items.get(c.itemId)!, r = roleOf(c);
      return {
        itemId: item.id, name: item.name, detail: item.detail, isBook: item.isBook, price: item.price,
        outcome: r.role === "holder" ? "holder" : "waiting", position: r.position,
      };
    };
    whatsappUrl = `${base}?text=${encodeURIComponent(buildMessage(found.name, [...holding, ...waitingClaims].map(unit), siteUrl, token as string))}`;
  }
  return { ok: true, booking: view, whatsappUrl };
}
