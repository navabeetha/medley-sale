// S-19: the "My reservations" API (story S-19; brief 2.7, 4.3, D-009, D-011). One request for every booking saved on a
// device: the units of all the found bookings merged into four sections, each unit carrying the token the client sent
// for its booking (Back out needs it), and the tokens that matched nothing so the site can forget them.
//
// Read-only and WITHOUT the script lock, for the same reason as booking(): it writes, flushes and clears nothing.
// Privacy: only data for tokens that were sent. No booking ids, names, numbers or row numbers in the sections; the seller's
// number appears only inside the two URLs. An unknown token is only ever echoed in notFound.
import { contactUrl } from "./catalogue";
import {
  backedOutUnits, findBooking, readBooking, snapshot, type BookingDeps, type BookingParts, type Line, type WaitingLine,
} from "./booking";
import { CLAIMS } from "./seller-sheet";
import type { Spreadsheet } from "./sheet";
import { cleanSiteUrl } from "./site-url";
import { buildBackedOutUrl, buildCombinedWhatsappUrl, type MessageUnit } from "../domain/message";

const BOOKINGS = "Bookings";
const MAX_TOKENS = 20;

type Tagged<T> = T & { token: string };
export type MineResponse =
  | {
    ok: true;
    reserved: Array<Tagged<Line>>;
    waiting: Array<Tagged<WaitingLine>>;
    sold: Array<Tagged<Line>>;
    backedOut: Array<Tagged<Line>>;
    notFound: string[];
    whatsappUrl: string | null;
    backedOutUrl: string | null;
  }
  | { ok: false; error: "invalid-request" | "not-reserving" };

export function mine(ss: Spreadsheet, request: unknown, deps: BookingDeps): MineResponse {
  const raw = typeof request === "object" && request !== null && !Array.isArray(request) ? (request as { tokens?: unknown }).tokens : undefined;
  // Validated before any sheet read: 1 to 20 non-empty strings.
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TOKENS || raw.some((t) => typeof t !== "string" || t === "")) {
    return { ok: false, error: "invalid-request" };
  }
  const tokens = [...new Set(raw as string[])]; // a repeat is asked once
  const claimsTab = ss.getTab(CLAIMS);
  if (!claimsTab || !ss.getTab(BOOKINGS)) return { ok: false, error: "not-reserving" }; // status mode (D-038.6)

  const snap = snapshot(ss, claimsTab, deps.now());
  const notFound: string[] = [];
  const found: Array<{ token: string; name: string; parts: BookingParts }> = [];
  const seenIds = new Set<number>();
  for (const token of tokens) {
    const b = findBooking(ss, token);
    if (!b) { notFound.push(token); continue; }
    if (seenIds.has(b.id)) continue; // two tokens for one booking cannot happen, but never double the units if they do
    seenIds.add(b.id);
    found.push({ token, name: b.name, parts: readBooking(snap, b) });
  }

  const tag = <T>(pick: (p: BookingParts) => T[]): Array<Tagged<T>> =>
    found.flatMap((f) => pick(f.parts).map((l) => ({ ...l, token: f.token })));
  const reserved = tag((p) => p.view.reserved);
  const waiting = tag((p) => p.view.waiting);
  const sold = tag((p) => p.view.sold);
  const backedOut = tag((p) => p.backedOut);

  // The first found booking's buyer speaks (the site sends the newest first).
  const base = contactUrl(deps.sellerWhatsapp);
  const siteUrl = cleanSiteUrl(deps.siteUrl);
  const first = found[0];
  const active: MessageUnit[] = found.flatMap((f) => f.parts.activeUnits);
  const linkTokens = found.filter((f) => f.parts.activeUnits.length > 0).map((f) => f.token);
  const whatsappUrl = base && siteUrl && first && active.length > 0
    ? buildCombinedWhatsappUrl(base, first.name, active, siteUrl, linkTokens)
    : null;
  const outUnits = found.flatMap((f) => backedOutUnits(f.parts.backedOut, snap.items));
  const backedOutUrl = base && first && outUnits.length > 0 ? buildBackedOutUrl(base, first.name, outUnits) : null;

  return { ok: true, reserved, waiting, sold, backedOut, notFound, whatsappUrl, backedOutUrl };
}
