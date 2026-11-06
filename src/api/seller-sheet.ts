// S-15: what the seller's edits and the timed repair share (brief 2.7, 4.1, 6.1 rules 3, 4, 6, 7, 8;
// D-003, D-010, D-026, D-038, D-039). Synchronous and pure over the Spreadsheet interface; the
// Apps Script adapter injects the lock, cache, clock and SITE_URL (src/appscript/main.ts).
//
// One recalculation writes, for each item it covers: Promoted at (and a cleared Notified on a new
// stamp), Sold at / Sold price on sold rows, and Message link on Claims, plus Status and Person on
// the item tab. To do and Sold are FILTER formulas over Claims (migrate.ts) and are never written.
// Claims are found by Claim ID and columns by header name, never by position (risk 10.3, 4.1).
import { CATALOGUE_CACHE_KEY } from "./handle-get";
import { findHeaderRow } from "./header-row";
import { numberText, text, unapostrophe, unguard } from "./cell-text";
import { colOf, guardText, isBlank, itemNameCol } from "./migrate";
import type { CellValue, Spreadsheet, Tab } from "./sheet";
import { cleanSiteUrl } from "./site-url";
import { itemStatus } from "../domain/item-status";
import { buildSellerMessage, type MessageUnit } from "../domain/message";
import { normalisePhone } from "../domain/phone";
import { isRefusalReason, recalculate, type ClaimInput, type ClaimResult, type ClaimRole, type ClaimState } from "../domain/queue";

export interface SellerDeps {
  /** Shape of Apps Script's ScriptLock. */
  lock: { waitLock(timeoutMs: number): void; releaseLock(): void };
  /** Shape of CacheService's cache; only the catalogue key is ever removed. */
  cache: { remove(key: string): void };
  /** ISO timestamp for Promoted at and Sold at. */
  now: () => string;
  /** Script Property SITE_URL, for the private link in Message link. Same rule as reserve. */
  siteUrl: string;
}

export const CLAIMS = "Claims";
/** The note on a State cell that holds something else (S-15 QA F3). Only this exact text is ever cleared as ours. */
export const NOT_A_STATE = "Not a valid state — choose active, released or sold";
/** S-14 F8: the note on a State cell that is empty on a row with a Claim ID. A different problem from a typo, so different words. */
export const BLANK_STATE = "This State cell is empty — choose active, released or sold";
/** Notes WE write on a State cell and may therefore remove on an accepted edit; anything else is the seller's own. */
export const isOurStateNote = (note: string | null): boolean =>
  note !== null && (note === NOT_A_STATE || note === BLANK_STATE || isRefusalReason(note));
/** S-13 Q1: our note goes only where the cell has no note or one of ours; the seller's own words are never replaced. */
export const canWriteStateNote = (note: string | null): boolean => note === null || note === "" || isOurStateNote(note);
const BOOKINGS = "Bookings";
/** A trigger may wait for a reserve in progress; under the lock the work takes well under a second. */
const LOCK_WAIT_MS = 30_000;

// ---- The lock (6.1 rule 6), same pattern as reserve

/**
 * waitLock -> work -> flush after the last write -> cache removal -> release. `work` calls its
 * `markWrote` before the first write, so a write that throws part-way still gets flushed and clears
 * the cache. The release is in its own outer finally (R2): a throwing flush must not leave the lock held.
 */
export function locked<T>(
  ss: Spreadsheet, deps: SellerDeps, work: (markWrote: () => void) => T, clearCache = true,
): { busy: true } | { busy: false; value: T } {
  try {
    deps.lock.waitLock(LOCK_WAIT_MS);
  } catch {
    return { busy: true }; // nothing written; the 10-minute job repairs it later
  }
  let wrote = false;
  try {
    return { busy: false, value: work(() => { wrote = true; }) };
  } finally {
    try {
      if (wrote) {
        try {
          ss.flush(); // commit while we still hold the lock, or the next reader sees stale Claims (QA F2)
        } finally {
          try { if (clearCache) deps.cache.remove(CATALOGUE_CACHE_KEY); } catch { /* the sheet is saved; a stale cache expires on its own */ }
        }
      }
    } finally {
      try { deps.lock.releaseLock(); } catch { /* the lock expires on its own */ }
    }
  }
}

// ---- Reading

export interface ClaimRow {
  /** 1-based sheet row. */
  row: number;
  claimId: number;
  bookingId: number | null;
  itemId: string;
  /** Rows with a State that is not one of the three never get here. */
  state: ClaimState;
  name: string;
  number: string | null;
  promotedAt: string | null;
  notified: CellValue | undefined;
  soldPrice: CellValue | undefined;
  soldAt: CellValue | undefined;
  link: CellValue | undefined;
}

export interface ClaimsSheet {
  tab: Tab;
  /** 1-based column per header; 0 when the sheet has no such column. */
  col: Record<string, number>;
  rows: ClaimRow[];
}

const CLAIM_COLUMNS = [
  "Claim ID", "Booking ID", "Item ID", "Name", "Number", "State", "Promoted at", "Notified", "Sold price", "Sold at", "Ended at", "Message link",
] as const;

export function claimColumns(tab: Tab): Record<string, number> {
  const head = tab.getGrid()[0] ?? [];
  return Object.fromEntries(CLAIM_COLUMNS.map((h) => [h, colOf(head, h)]));
}

export function readClaims(tab: Tab): ClaimsSheet {
  const col = claimColumns(tab);
  if (!col["Claim ID"] || !col["Item ID"] || !col["State"]) throw new Error("Claims tab is missing a required column");
  const rows: ClaimRow[] = [];
  tab.getGrid().slice(1).forEach((r, i) => {
    const at = (h: string): CellValue | undefined => (col[h] ? r[col[h]! - 1] : undefined);
    const state = at("State");
    const itemId = text(at("Item ID"));
    const claimId = at("Claim ID") === null || at("Claim ID") === "" ? NaN : Number(at("Claim ID"));
    if (!itemId || !Number.isFinite(claimId) || (state !== "active" && state !== "released" && state !== "sold")) return;
    const promoted = at("Promoted at");
    const booking = text(at("Booking ID"));
    rows.push({
      row: i + 2, claimId, itemId, state,
      bookingId: booking === null || !Number.isFinite(Number(booking)) ? null : Number(booking),
      name: unguard(text(at("Name")) ?? ""),
      number: numberText(at("Number")), // F4: a numeric cell is +91...
      promotedAt: promoted instanceof Date ? promoted.toISOString() : text(promoted),
      notified: at("Notified"), soldPrice: at("Sold price"), soldAt: at("Sold at"), link: at("Message link"),
    });
  });
  return { tab, col, rows };
}

export interface ItemRow {
  id: string;
  name: string;
  /** Brand, or on Books the author. */
  detail: string | null;
  isBook: boolean;
  price: number | null;
  quantity: number; // NaN when the cell is not a number
  tab: Tab;
  /** 1-based sheet row and the Status / Person columns (0 = this tab has none). */
  row: number;
  statusCol: number;
  personCol: number;
  currentStatus: CellValue | undefined;
  currentPerson: CellValue | undefined;
}

/** Every item on every item tab, found by the ID column. First row wins on a repeated ID. */
export function readItems(ss: Spreadsheet): Map<string, ItemRow> {
  const items = new Map<string, ItemRow>();
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
    const statusCol = colOf(head, "Status");
    const personCol = colOf(head, "Person");
    grid.slice(hr + 1).forEach((row, i) => {
      const id = text(row[idCol - 1]);
      const name = text(row[nameCol - 1]);
      if (!id || !name || items.has(id)) return;
      const price = priceCol ? row[priceCol - 1] : null;
      const qty = qtyCol ? row[qtyCol - 1] : null;
      items.set(id, {
        id, name, isBook, tab, row: hr + i + 2, statusCol, personCol,
        detail: detailCol ? text(row[detailCol - 1]) : null,
        price: typeof price === "number" ? price : null,
        quantity: typeof qty === "number" ? qty : NaN,
        currentStatus: statusCol ? row[statusCol - 1] : undefined,
        currentPerson: personCol ? row[personCol - 1] : undefined,
      });
    });
  }
  return items;
}

/** Private-link tokens by Booking ID; empty when there is no Bookings tab. */
export function readTokens(ss: Spreadsheet): Map<number, string> {
  const out = new Map<number, string>();
  const grid = ss.getTab(BOOKINGS)?.getGrid() ?? [];
  const head = grid[0] ?? [];
  const idCol = colOf(head, "Booking ID"), tokenCol = colOf(head, "Token");
  if (!idCol || !tokenCol) return out;
  for (const r of grid.slice(1)) {
    const token = text(r[tokenCol - 1]);
    const id = text(r[idCol - 1]);
    if (token !== null && id !== null && Number.isFinite(Number(id))) out.set(Number(id), unapostrophe(token));
  }
  return out;
}

// ---- Queue

const toInput = (c: ClaimRow, previousRole: ClaimRole | null, state: ClaimState = c.state): ClaimInput => ({
  claimId: c.claimId, itemId: c.itemId, state, promotedAt: c.promotedAt, previousRole,
});

export const itemInput = (item: ItemRow): { id: string; quantity: number } => ({ id: item.id, quantity: item.quantity });

/** Each claim's role in a recalculation that only reads (previousRole null). */
export function rolesOf(item: ItemRow, claims: ClaimInput[], now: string): Map<number, ClaimRole> {
  return new Map(recalculate(itemInput(item), claims, now).claims.map((c) => [c.claimId, c.role]));
}

export { toInput };

// ---- Writing

/** Cells match when both are blank, or the same value (a guarded text equals what real Sheets reads back). */
function same(current: CellValue | undefined, next: CellValue): boolean {
  const blankCur = current === undefined || current === null || current === "";
  const blankNext = next === null || next === "";
  if (blankCur || blankNext) return blankCur && blankNext;
  if (typeof current === "string" && typeof next === "string") return current === next || current === unguard(next);
  return current === next;
}

/** Writes one cell unless it already holds the value, so a repeat run writes nothing. */
export function put(tab: Tab, row: number, col: number, current: CellValue | undefined, next: CellValue, markWrote: () => void): void {
  if (!col || same(current, next)) return;
  markWrote();
  tab.setCell(row, col, next);
}

/** Wording for the Message link of an active claim, or null if it can't be built. */
function messageLink(
  c: ClaimRow, result: ClaimResult, item: ItemRow, tokens: Map<number, string>, siteUrl: string | null,
): string | null {
  if (c.state !== "active" || c.number === null || siteUrl === null || c.bookingId === null) return null;
  const token = tokens.get(c.bookingId);
  const phone = normalisePhone(unapostrophe(c.number));
  if (!token || !phone) return null;
  const unit: MessageUnit = {
    itemId: item.id, name: item.name, detail: item.detail, isBook: item.isBook, price: item.price,
    outcome: result.role === "holder" ? "holder" : "waiting", position: result.position,
  };
  // wa.me wants the digits only; the text is URL-encoded (encodeURIComponent: URL is not in Apps Script V8).
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(buildSellerMessage(c.name, unit, siteUrl, token))}`;
}

export interface Shared {
  ss: Spreadsheet;
  claims: ClaimsSheet;
  deps: SellerDeps;
  now: string;
  markWrote: () => void;
}

/**
 * Recalculates one item and writes everything that follows from it. `previousRoles` is each claim's
 * role before this change (D-026.2): from the before-edit claims on an edit, from the current state
 * on the timed repair (D-039: that job never invents a promotion). `leftSold` is the claim that was
 * just taken out of sold, whose Sold at is cleared (Sold price is kept).
 */
export function applyItem(sh: Shared, item: ItemRow, previousRoles: Map<number, ClaimRole>, tokens: Map<number, string>, leftSold: number | null): void {
  const { claims, markWrote, now } = sh;
  const own = claims.rows.filter((c) => c.itemId === item.id);
  const calc = recalculate(itemInput(item), own.map((c) => toInput(c, previousRoles.get(c.claimId) ?? null)), now);
  const results = new Map(calc.claims.map((r) => [r.claimId, r]));
  const siteUrl = cleanSiteUrl(sh.deps.siteUrl);
  const { tab, col } = claims;

  for (const c of own) {
    const r = results.get(c.claimId)!;
    put(tab, c.row, col["Promoted at"]!, c.promotedAt, r.promotedAt, markWrote);
    // A new stamp means a new To do row, so an old tick must not hide it (D-026 accepted cost).
    const fresh = r.promotedAt !== null && r.promotedAt !== c.promotedAt;
    if (fresh && c.notified !== null && c.notified !== undefined && c.notified !== "" && c.notified !== false) {
      put(tab, c.row, col["Notified"]!, c.notified, null, markWrote);
    }
    // Setting sold fills Sold at and defaults Sold price; an edited value is kept. The timed job
    // repairs a sale whose edit was missed the same way.
    if (c.state === "sold") {
      if (isBlank(c.soldAt)) put(tab, c.row, col["Sold at"]!, c.soldAt, now, markWrote);
      if (isBlank(c.soldPrice) && item.price !== null) put(tab, c.row, col["Sold price"]!, c.soldPrice, item.price, markWrote);
    } else if (c.claimId === leftSold) {
      put(tab, c.row, col["Sold at"]!, c.soldAt, null, markWrote); // an undone sale; Sold price stays
    }
    put(tab, c.row, col["Message link"]!, c.link, messageLink(c, r, item, tokens, siteUrl), markWrote);
  }

  if (calc.unavailable) return; // D-026.3: Status and Person of an unavailable item are the seller's to keep
  const sold = own.filter((c) => c.state === "sold").length;
  const holders = calc.claims.filter((r) => r.role === "holder").length;
  put(item.tab, item.row, item.statusCol, item.currentStatus, itemStatus(calc.unitsLeft, sold, holders), markWrote);
  // Sold and holding names in Claim ID order; one guard on the whole text (6.3), after the stored guard is stripped.
  const people = own
    .filter((c) => c.state === "sold" || results.get(c.claimId)!.role === "holder")
    .sort((a, b) => a.claimId - b.claimId)
    .map((c) => c.name)
    .filter((n) => n !== "");
  put(item.tab, item.row, item.personCol, item.currentPerson, people.length ? guardText(people.join(", ")) : null, markWrote);
}

// ---- Typo'd State cells (QA F3)

/**
 * Keeps our State-cell notes true on every row with a Claim ID (readClaims drops the bad ones, so this reads the RAW
 * grid): NOT_A_STATE on a State that is not active / released / sold, BLANK_STATE on an empty one (F8), nothing on a
 * valid one, where either note of ours is cleared. Any other note is left alone, and a cell already right is not
 * written (stable runs). The notes come from ONE getNotes call (F7): this runs under the lock, and a read per row
 * would hold it long enough for a concurrent reserve to answer "busy".
 */
export function syncStateNotes(tab: Tab, markWrote: () => void): void {
  const grid = tab.getGrid();
  const head = grid[0] ?? [];
  const idCol = colOf(head, "Claim ID"), stateCol = colOf(head, "State");
  if (!idCol || !stateCol) return;
  const notes = tab.getNotes(stateCol);
  grid.slice(1).forEach((r, i) => {
    const row = i + 2;
    const state = text(r[stateCol - 1]);
    const hasId = text(r[idCol - 1]) !== null;
    const valid = state === "active" || state === "released" || state === "sold";
    const want = !hasId || valid ? null : state === null ? BLANK_STATE : NOT_A_STATE;
    const note = notes[row - 1] ?? null;
    if (want !== null && note !== want && canWriteStateNote(note)) { markWrote(); tab.setNote(row, stateCol, want); }
    else if (want === null && (note === NOT_A_STATE || note === BLANK_STATE)) { markWrote(); tab.setNote(row, stateCol, ""); } // fixed, or no longer a claim row
  });
}

/**
 * The timed repair's body, under a lock the caller holds (D-039): every item recalculated with each
 * claim's previous role = its current role, so nobody new is stamped. Shared by recalculateAll and by
 * an edit whose row no longer holds the edited claim (QA F2).
 */
export function repairAll(ss: Spreadsheet, claimsTab: Tab, deps: SellerDeps, markWrote: () => void): void {
  syncStateNotes(claimsTab, markWrote);
  const sheet = readClaims(claimsTab);
  const items = readItems(ss);
  const tokens = readTokens(ss);
  const now = deps.now();
  for (const item of items.values()) {
    const own = sheet.rows.filter((c) => c.itemId === item.id);
    applyItem({ ss, claims: sheet, deps, now, markWrote }, item, rolesOf(item, own.map((c) => toInput(c, null)), now), tokens, null);
  }
}
