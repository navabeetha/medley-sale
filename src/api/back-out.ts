// S-14: the buyer backs out of one claim (brief 2.7, 4.3, 6.1 rules 3, 5, 6, 8, 6.4; D-005, D-010, D-011, D-026, D-039).
// Everything happens under the script lock, in reserve's order: waitLock, reads, writes, flush, cache removal, release.
//
// The queue consequences are the seller-sheet logic's own (applyItem), fed each claim's role from BEFORE the write
// (D-026.2): a holder leaving stamps the waiter who moves up (so they appear in To do) and loses their own stamp;
// a waiter leaving stamps nobody. A repeated request finds the claim already released and answers ok, writing nothing.
import { booking, findBooking, type BookingResponse } from "./booking";
import { contactUrl } from "./catalogue";
import { CLAIMS, applyItem, locked, readClaims, readItems, readTokens, rolesOf, toInput, type SellerDeps } from "./seller-sheet";
import type { Spreadsheet } from "./sheet";
import { title } from "../domain/message";

export interface BackOutDeps extends SellerDeps {
  /** Script Property SELLER_WHATSAPP, for tellSellerUrl and the booking's whatsappUrl. */
  sellerWhatsapp?: string;
}

export type BackOutResponse =
  | { ok: true; booking: Extract<BookingResponse, { ok: true }>["booking"]; whatsappUrl: string | null; tellSellerUrl: string | null; backedOutUrl: string | null }
  | { ok: false; error: "not-found" | "not-allowed" | "not-reserving" | "busy" };

const NOT_FOUND = { ok: false, error: "not-found" } as const;

export function backOut(ss: Spreadsheet, request: unknown, deps: BackOutDeps): BackOutResponse {
  const claimsTab = ss.getTab(CLAIMS);
  if (!claimsTab || !ss.getTab("Bookings")) return { ok: false, error: "not-reserving" }; // status mode (D-038.6): no lock
  const body = typeof request === "object" && request !== null && !Array.isArray(request) ? (request as { token?: unknown; claimId?: unknown }) : {};
  const { token, claimId } = body;
  // A shape no real request has: the same answer as an unknown claim, before any lock or read.
  if (typeof token !== "string" || typeof claimId !== "number" || !Number.isInteger(claimId) || claimId < 1) return NOT_FOUND;

  const out = locked(ss, deps, (markWrote): BackOutResponse => {
    const found = findBooking(ss, token);
    const sheet = readClaims(claimsTab);
    const claim = sheet.rows.find((c) => c.claimId === claimId);
    // Another buyer's claim looks exactly like a claim that does not exist.
    if (!found || !claim || claim.bookingId !== found.id) return NOT_FOUND;
    if (claim.state === "sold") return { ok: false, error: "not-allowed" }; // only the seller can undo a sale
    const items = readItems(ss);
    const item = items.get(claim.itemId);

    if (claim.state === "active") {
      const now = deps.now();
      const own = sheet.rows.filter((c) => item && c.itemId === item.id);
      // Roles before the write (D-026.2), so applyItem can tell who has just moved up.
      const previousRoles = item ? rolesOf(item, own.map((c) => toInput(c, null)), now) : new Map();
      markWrote();
      claimsTab.setCell(claim.row, sheet.col["State"]!, "released");
      if (sheet.col["Ended at"]) claimsTab.setCell(claim.row, sheet.col["Ended at"], now);
      if (item) {
        // applyItem reads the claims it is given, so hand it the released one.
        const after = { ...sheet, rows: sheet.rows.map((c) => (c === claim ? { ...c, state: "released" as const } : c)) };
        applyItem({ ss, claims: after, deps, now, markWrote }, item, previousRoles, readTokens(ss), null);
      }
    }

    const view = booking(ss, { token }, { now: deps.now, siteUrl: deps.siteUrl, sellerWhatsapp: deps.sellerWhatsapp });
    if (!view.ok) return NOT_FOUND;
    // The optional "Tell the seller" message: the buyer's voice, no number and no private link (D-011).
    const base = contactUrl(deps.sellerWhatsapp);
    const what = item ? title({ itemId: item.id, name: item.name, detail: item.detail, isBook: item.isBook, price: item.price, outcome: "holder", position: null }) : "my reservation";
    const message = `Hi! I'm ${found.name.replace(/\s+/g, " ")}. I've backed out of ${what}.`;
    return { ok: true, booking: view.booking, whatsappUrl: view.whatsappUrl, backedOutUrl: view.backedOutUrl, tellSellerUrl: base ? `${base}?text=${encodeURIComponent(message)}` : null };
  });
  return out.busy ? { ok: false, error: "busy" } : out.value;
}
