// S-11: the reserve API (brief 4.3, 6.1 rule 6, 6.3, 2.8; D-005, D-008, D-011,
// D-026, D-030, D-036, D-038). Synchronous and pure over the Spreadsheet
// interface: the Apps Script adapter injects the lock, cache, randomness, clock
// and Script Properties (src/appscript/main.ts `doPostRun`).
//
// Shape of one call: validate without touching the sheet -> take the script lock
// -> read everything -> decide -> write -> clear the catalogue cache -> release.
// Nothing is read before the lock: a read outside it can be stale by the time we
// write, which is how two buyers would both become "holder" of the last unit.
import { contactUrl } from "./catalogue";
import { CATALOGUE_CACHE_KEY } from "./handle-get";
import { findHeaderRow } from "./header-row";
import { colOf, guardText, hex, itemNameCol } from "./migrate";
import type { CellValue, Spreadsheet, Tab } from "./sheet";
import { numberText, text, unapostrophe, unguard } from "./cell-text";
import { cleanSiteUrl } from "./site-url";
import { buildWhatsappUrl, type MessageUnit } from "../domain/message";
import { normalisePhone } from "../domain/phone";
import { recalculate, type ClaimInput, type ClaimResult, type ClaimRole, type ClaimState } from "../domain/queue";

export interface ReserveDeps {
  /** Shape of Apps Script's ScriptLock. */
  lock: { waitLock(timeoutMs: number): void; releaseLock(): void };
  /** Shape of CacheService's cache; only the catalogue key is ever removed. */
  cache: { remove(key: string): void };
  /** n random bytes (D-005); the adapter builds them from UUIDs. */
  randomBytes: (n: number) => Uint8Array;
  /** ISO timestamp for Created and Promoted at. */
  now: () => string;
  /** Script Property SELLER_WHATSAPP; same rules as the catalogue's contactUrl (D-036). */
  sellerWhatsapp?: string;
  /** Script Property SITE_URL, for the private booking link in the message. */
  siteUrl: string;
}

export interface ReserveUnit {
  claimId: number;
  itemId: string;
  name: string;
  outcome: "holder" | "waiting";
  position: number | null;
}
export interface SkippedItem {
  id: string;
  name: string | null;
  reason: "sold-out" | "unavailable";
}
export type ReserveError =
  | "invalid-name" | "invalid-number" | "invalid-basket" | "invalid-request"
  | "too-many-claims" | "nothing-available" | "not-reserving" | "not-configured" | "busy";
export type ReserveResponse =
  | { ok: true; token: string; bookingId: number; units: ReserveUnit[]; skipped: SkippedItem[]; whatsappUrl: string | null }
  | { ok: false; error: ReserveError; skipped?: SkippedItem[] };

// Limits from brief 6.3.
const MIN_NAME = 2;
const MAX_NAME = 60;
const MAX_UNITS_PER_BASKET = 15;
const MAX_ACTIVE_CLAIMS_PER_NUMBER = 20;
/** How long to wait for the script lock. Under it the whole call takes well under a second. */
const LOCK_WAIT_MS = 30_000;

/**
 * QA F4: an idempotency key is a bearer secret for the booking it made, so it must be long and plain.
 * This also keeps formulas and odd text out of the sheet.
 */
const KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
const CLAIMS = "Claims";
const BOOKINGS = "Bookings";
/** Tabs customers can see items from (D-030 rule 9). Anything else is "unavailable", even if it has the item. */
const PUBLISHED_TABS = ["Tech", "Gym & Sport", "Home Things", "Books"];

interface ParsedRequest {
  name: string;
  number: string; // E.164
  key: string;
  lines: { id: string; quantity: number }[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (error: ReserveError, skipped?: SkippedItem[]): ReserveResponse => (skipped ? { ok: false, error, skipped } : { ok: false, error });

/** Everything checkable without the sheet. A string means the error code to answer with. */
function parse(request: Record<string, unknown>): ParsedRequest | ReserveError {
  const key = request.idempotencyKey;
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return "invalid-request";
  const name = typeof request.name === "string" ? request.name.trim() : "";
  if (name.length < MIN_NAME || name.length > MAX_NAME) return "invalid-name";
  const number = normalisePhone(request.number);
  if (!number) return "invalid-number";
  const items = request.items;
  if (!Array.isArray(items) || items.length === 0) return "invalid-basket";
  const lines: ParsedRequest["lines"] = [];
  let total = 0;
  for (const it of items as unknown[]) {
    const id = isObject(it) ? it.id : undefined;
    const q = isObject(it) ? it.quantity : undefined;
    if (typeof id !== "string" || id.trim() === "" || typeof q !== "number" || !Number.isInteger(q) || q < 1) return "invalid-basket";
    total += q;
    lines.push({ id: id.trim(), quantity: q });
  }
  // The cap counts every unit asked for, skipped ones included.
  if (total > MAX_UNITS_PER_BASKET) return "invalid-basket";
  return { name, number, key, lines };
}

// ---- Reading the sheet (columns by header name, brief 4.1)

interface ItemInfo {
  id: string;
  name: string;
  /** Brand, or on Books the author. */
  detail: string | null;
  isBook: boolean;
  price: number | null;
  quantity: number; // NaN when the cell is not a number
  published: boolean;
}

/** True when a stored cell holds `value` (once its apostrophe, if any, is removed). */
const sameText = (cell: CellValue | undefined, value: string, read: (v: CellValue | undefined) => string | null = text): boolean => {
  const c = read(cell);
  return c !== null && unapostrophe(c) === value;
};
/** Is the honeypot field filled in? `0`, false, null, "" and absent are not (QA F8: autofill must not lose a real booking). */
const trapTripped = (v: unknown): boolean =>
  (typeof v === "string" && v !== "") || v === true || (typeof v === "number" && v !== 0);

/** Every item on every item tab, hidden ones too: we need a hidden item's name to skip it politely. */
function readItems(ss: Spreadsheet): Map<string, ItemInfo> {
  const items = new Map<string, ItemInfo>();
  for (const tab of ss.getTabs()) {
    const grid = tab.getGrid();
    const hr = findHeaderRow(grid); // system tabs have no "Person" header, so they drop out here
    if (hr < 0) continue;
    const head = grid[hr]!;
    const idCol = colOf(head, "ID");
    const nameCol = itemNameCol(tab, head);
    if (!idCol || !nameCol) continue;
    const isBook = tab.name === "Books";
    const detailCol = isBook ? colOf(head, "Author") : colOf(head, "Brand (+ Link)") || colOf(head, "Brand");
    const priceCol = colOf(head, "Price");
    const qtyCol = colOf(head, "Quantity");
    for (const row of grid.slice(hr + 1)) {
      const id = text(row[idCol - 1]);
      const name = text(row[nameCol - 1]);
      if (!id || !name || items.has(id)) continue;
      const price = priceCol ? row[priceCol - 1] : null;
      const qty = qtyCol ? row[qtyCol - 1] : null;
      items.set(id, {
        id, name, isBook,
        detail: detailCol ? text(row[detailCol - 1]) : null,
        price: typeof price === "number" ? price : null,
        quantity: typeof qty === "number" ? qty : NaN,
        published: PUBLISHED_TABS.includes(tab.name),
      });
    }
  }
  return items;
}

interface ClaimRow {
  /** 1-based sheet row, for writing Promoted at back. */
  row: number;
  claimId: number;
  bookingId: string | null;
  itemId: string;
  state: ClaimState;
  number: string | null;
  promotedAt: string | null;
}

function readClaims(tab: Tab): { head: CellValue[]; rows: ClaimRow[]; maxClaimId: number; rawBookingIds: Set<number> } {
  const grid = tab.getGrid();
  const head = grid[0] ?? [];
  const c = Object.fromEntries(["Claim ID", "Booking ID", "Item ID", "Number", "State", "Promoted at"].map((h) => [h, colOf(head, h)]));
  if (!c["Claim ID"] || !c["Item ID"] || !c["State"] || !c["Promoted at"]) throw new Error("Claims tab is missing a required column");
  const at = (r: CellValue[], h: string): CellValue | undefined => (c[h] ? r[c[h]! - 1] : undefined);
  const rows: ClaimRow[] = [];
  grid.slice(1).forEach((r, i) => {
    const state = at(r, "State");
    const itemId = text(at(r, "Item ID"));
    const claimId = Number(at(r, "Claim ID"));
    if (!itemId || !Number.isFinite(claimId) || (state !== "active" && state !== "released" && state !== "sold")) return;
    const promoted = at(r, "Promoted at");
    rows.push({
      row: i + 2, claimId, itemId, state,
      bookingId: text(at(r, "Booking ID")),
      number: numberText(at(r, "Number")), // F4: a numeric cell is +91...
      promotedAt: promoted instanceof Date ? promoted.toISOString() : text(promoted),
    });
  });
  // From the whole column, so a row with an odd State still keeps its id out of reuse.
  // R1: every Booking ID present in the raw grid, whatever the row's State, so a typo'd State never makes a booking look orphaned.
  const rawBookingIds = new Set<number>();
  if (c["Booking ID"]) for (const r of grid.slice(1)) { const v = r[c["Booking ID"]! - 1]; if (v !== null && v !== undefined && v !== "") rawBookingIds.add(Number(v)); }
  return { head, rows, maxClaimId: maxNumber(grid, c["Claim ID"]!), rawBookingIds };
}

/** Highest numeric value in a column (non-numbers ignored), or 0. */
function maxNumber(grid: CellValue[][], column: number): number {
  let max = 0;
  for (const r of grid.slice(1)) {
    const n = Number(r[column - 1]);
    if (r[column - 1] !== null && r[column - 1] !== "" && Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** A row for appendRow with each value under its header; columns we don't know stay blank. */
function rowFor(tab: string, head: CellValue[], values: Record<string, CellValue>): CellValue[] {
  for (const h of Object.keys(values)) if (!colOf(head, h)) throw new Error(`${tab} tab is missing the column ${h}`);
  return head.map((h) => (typeof h === "string" && h.trim() in values ? values[h.trim()]! : null));
}

// ---- The queue

const toInput = (c: ClaimRow, previousRole: ClaimRole | null): ClaimInput => ({
  claimId: c.claimId, itemId: c.itemId, state: c.state, promotedAt: c.promotedAt, previousRole,
});

/** Current queue result for every claim of one item, keyed by claim id (previousRole null: we only read). */
function resultsFor(item: ItemInfo, claims: ClaimRow[], now: string): Map<number, ClaimResult> {
  const r = recalculate({ id: item.id, quantity: item.quantity }, claims.map((c) => toInput(c, null)), now);
  return new Map(r.claims.map((c) => [c.claimId, c]));
}

/** Pairs a unit with the item data the WhatsApp message needs. */
const messageUnit = (u: ReserveUnit, item: ItemInfo): MessageUnit => ({
  itemId: u.itemId, name: u.name, detail: item.detail, isBook: item.isBook, price: item.price, outcome: u.outcome, position: u.position,
});

function whatsappUrl(deps: ReserveDeps, name: string, units: MessageUnit[], token: string): string | null {
  const base = contactUrl(deps.sellerWhatsapp);
  return base ? buildWhatsappUrl(base, name, units, deps.siteUrl, token) : null;
}

// ---- The handler

export function reserve(ss: Spreadsheet, request: unknown, deps: ReserveDeps): ReserveResponse {
  if (!isObject(request)) return fail("invalid-request");

  // 6.3 honeypot: a bot fills the hidden field. Answer like a success so it learns
  // nothing, but save nothing, take no lock and clear no cache. The token matches no booking.
  if (trapTripped(request.website)) {
    return { ok: true, token: hex(deps.randomBytes(16)), bookingId: 0, units: [], skipped: [], whatsappUrl: null };
  }

  // QA F3: refuse before the lock when the private link could not be built.
  // R3: the trimmed URL is the one used from here on.
  const siteUrl = cleanSiteUrl(deps.siteUrl);
  if (siteUrl === null) return fail("not-configured");
  const parsed = parse(request);
  if (typeof parsed === "string") return fail(parsed);
  const claimsTab = ss.getTab(CLAIMS);
  const bookingsTab = ss.getTab(BOOKINGS);
  if (!claimsTab || !bookingsTab) return fail("not-reserving"); // status mode (D-038.6)

  try {
    deps.lock.waitLock(LOCK_WAIT_MS);
  } catch {
    return fail("busy");
  }
  let wrote = false;
  try {
    return reserveLocked(ss, claimsTab, bookingsTab, parsed, { ...deps, siteUrl }, () => { wrote = true; });
  } finally {
    // R2: releasing the lock is in its own outer finally, so a flush that throws still frees it.
    try {
      // A write that failed part-way may still have changed the queue, so clear the cache then too.
      if (wrote) {
        try {
          // QA F2: Apps Script may batch writes; commit them while we still hold the lock, or the next
          // request could read stale Claims and make two holders of the last unit.
          ss.flush();
        } finally {
          try { deps.cache.remove(CATALOGUE_CACHE_KEY); } catch { /* the booking is saved; a stale cache expires on its own */ }
        }
      }
    } finally {
      // QA F6: a failing release must not turn a saved booking into an error (the lock expires on its own).
      try { deps.lock.releaseLock(); } catch { /* ignore */ }
    }
  }
}

/** Runs with the script lock held. `markWrote` is called before the first write. */
function reserveLocked(
  ss: Spreadsheet, claimsTab: Tab, bookingsTab: Tab, req: ParsedRequest, deps: ReserveDeps, markWrote: () => void,
): ReserveResponse {
  const now = deps.now();
  const items = readItems(ss);
  const { head: claimHead, rows: claims, maxClaimId, rawBookingIds } = readClaims(claimsTab);
  const bookingGrid = bookingsTab.getGrid();
  const bookingHead = bookingGrid[0] ?? [];

  // T-08 idempotency: a repeated key returns the original booking, before any limit is applied.
  const keyCol = colOf(bookingHead, "Idempotency key");
  const previous = keyCol ? bookingGrid.slice(1).find((r) => sameText(r[keyCol - 1], req.key)) : undefined;
  // Pieces of an earlier booking we may be completing (QA F1b); null for a fresh booking.
  let resume: { bookingId: number; token: string } | null = null;
  if (previous) {
    const prev = (h: string): CellValue | undefined => previous[colOf(bookingHead, h) - 1];
    // QA F4: only the number that made the booking may replay it. Never reveal its token otherwise.
    if (!sameText(prev("Number"), req.number, numberText)) return fail("invalid-request");
    const prevId = Number(prev("Booking ID"));
    // R1: orphaned only when NO raw row carries the id; a row with an odd State still counts as saved.
    if (rawBookingIds.has(prevId)) {
      return replay(previous, bookingHead, claims, items, deps, now);
    }
    // QA F1b: the booking exists but none of its claims were saved (the claims write failed).
    // Finish it under the original id and token rather than answer an empty success.
    resume = { bookingId: prevId, token: unapostrophe(text(prev("Token")) ?? "") };
  }

  // Decide what each requested line can get. Skipped lines are named, in request order.
  const skipped: SkippedItem[] = [];
  const accepted: { item: ItemInfo; quantity: number }[] = [];
  for (const line of req.lines) {
    const item = items.get(line.id);
    if (!item) { skipped.push({ id: line.id, name: null, reason: "unavailable" }); continue; }
    const calc = recalculate({ id: item.id, quantity: item.quantity }, claims.map((c) => toInput(c, null)), now);
    if (!item.published || calc.unavailable) skipped.push({ id: item.id, name: item.name, reason: "unavailable" });
    else if (calc.soldOut) skipped.push({ id: item.id, name: item.name, reason: "sold-out" });
    else accepted.push({ item, quantity: line.quantity });
  }
  if (accepted.length === 0) return fail("nothing-available", skipped);

  // 6.3: at most 20 active claims per number, counting the units this request would add.
  const newUnits = accepted.reduce((n, a) => n + a.quantity, 0);
  const activeForNumber = claims.filter((c) => c.state === "active" && c.number !== null && unguard(c.number) === req.number).length;
  if (activeForNumber + newUnits > MAX_ACTIVE_CLAIMS_PER_NUMBER) return fail("too-many-claims");

  // New claims, ascending ids after the highest ever used (any state, so ids are never reused).
  let nextClaimId = maxClaimId + 1;
  const created: { claimId: number; item: ItemInfo }[] = [];
  for (const a of accepted) for (let i = 0; i < a.quantity; i++) created.push({ claimId: nextClaimId++, item: a.item });

  // D-026.2: each existing claim's role BEFORE the write goes in as previousRole, so the
  // recalculation can tell who this write promoted and keep the others' Promoted at.
  const touched = [...new Map(created.map((c) => [c.item.id, c.item])).values()];
  const after = new Map<number, ClaimResult>();
  for (const item of touched) {
    const before = resultsFor(item, claims, now);
    const inputs = [
      ...claims.map((c) => toInput(c, before.get(c.claimId)?.role ?? null)),
      ...created.filter((c) => c.item.id === item.id).map((c): ClaimInput => ({
        claimId: c.claimId, itemId: item.id, state: "active", promotedAt: null, previousRole: null,
      })),
    ];
    for (const c of recalculate({ id: item.id, quantity: item.quantity }, inputs, now).claims) after.set(c.claimId, c);
  }

  const units: ReserveUnit[] = created.map(({ claimId, item }) => {
    const r = after.get(claimId)!;
    return { claimId, itemId: item.id, name: item.name, outcome: r.role === "holder" ? "holder" : "waiting", position: r.position };
  });

  const token = resume ? resume.token : hex(deps.randomBytes(16));
  const bookingId = resume ? resume.bookingId : maxNumber(bookingGrid, colOf(bookingHead, "Booking ID")) + 1;
  const number = guardText(req.number);
  const name = guardText(req.name);

  // Booking first, then ALL claims in one batched write (QA F1a): a failure leaves a booking with
  // zero claims, never some. A retry completes it (F1b). Claims without a booking never happen,
  // because claims move everyone's queue. Token and key get a forced apostrophe (QA F9).
  markWrote();
  if (!resume) {
    bookingsTab.appendRow(rowFor(BOOKINGS, bookingHead, {
      "Booking ID": bookingId, Token: `'${token}`, Name: name, Number: number, Created: now, "Idempotency key": `'${req.key}`,
    }));
  }
  claimsTab.appendRows(created.map(({ claimId, item }) => rowFor(CLAIMS, claimHead, {
    "Claim ID": claimId, "Booking ID": bookingId, "Item ID": item.id, Item: guardText(item.name), Name: name,
    Number: number, State: "active", Created: now,
  })));
  // Promoted at for the touched items' older claims: kept for holders, cleared for non-holders (6.1 rule 3).
  const promotedCol = colOf(claimHead, "Promoted at");
  for (const c of claims) {
    const r = after.get(c.claimId);
    if (r && r.promotedAt !== c.promotedAt) claimsTab.setCell(c.row, promotedCol, r.promotedAt);
  }

  return {
    ok: true, token, bookingId, units, skipped,
    whatsappUrl: whatsappUrl(deps, req.name, units.map((u) => messageUnit(u, items.get(u.itemId)!)), token),
  };
}

/** The original answer for a repeated idempotency key, rebuilt from the sheet. Writes nothing. */
function replay(
  booking: CellValue[], bookingHead: CellValue[], claims: ClaimRow[], items: Map<string, ItemInfo>, deps: ReserveDeps, now: string,
): ReserveResponse {
  const cell = (h: string): CellValue | undefined => booking[colOf(bookingHead, h) - 1];
  const bookingId = Number(cell("Booking ID"));
  const token = unapostrophe(text(cell("Token")) ?? "");
  const name = unguard(text(cell("Name")) ?? "");

  // Current outcomes of this booking's claims. `skipped` is not stored, so it is [] on a replay.
  const results = new Map<string, Map<number, ClaimResult>>();
  const units: ReserveUnit[] = [];
  for (const c of claims.filter((x) => x.bookingId !== null && Number(x.bookingId) === bookingId).sort((a, b) => a.claimId - b.claimId)) {
    const item = items.get(c.itemId);
    if (!item) continue;
    if (!results.has(item.id)) results.set(item.id, resultsFor(item, claims, now));
    const r = results.get(item.id)!.get(c.claimId)!;
    if (r.role === "ended") continue; // backed out since
    units.push({ claimId: c.claimId, itemId: item.id, name: item.name, outcome: r.role === "waiting" ? "waiting" : "holder", position: r.position });
  }
  return {
    ok: true, token, bookingId, units, skipped: [],
    whatsappUrl: whatsappUrl(deps, name, units.map((u) => messageUnit(u, items.get(u.itemId)!)), token),
  };
}
