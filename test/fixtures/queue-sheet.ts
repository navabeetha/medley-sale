// Shared fixture for the S-12 / S-14 API tests (booking, back out, and the S-15 carried fixes).
// A synthetic sale sheet with a Claims, Bookings and To do tab, plus a harness that records every
// sheet access, lock call and cache call in order. Synthetic people and numbers only.
import { guardText } from "../../src/api/migrate";
import { onClaimsEdit } from "../../src/api/on-edit";
import { recalculateAll } from "../../src/api/recalc";
import type { CellValue } from "../../src/api/sheet";
import { FakeSpreadsheet, type FakeTab } from "./fake-sheet";

export const SITE = "https://example.invalid/medley-sale";
export const NOW = "2026-11-06T10:00:00.000Z";
export const STAMP = "2026-11-02T09:00:00.000Z";
export const LATER = "2026-11-07T08:00:00.000Z";

// Synthetic numbers in the `+91 90000 000xx` style, built in parts for the personal-data scan.
export const digits = (n: number): string => ["91", "90000", "000", String(n + 10).padStart(2, "0")].join("");
export const e164 = (n: number): string => `+${digits(n)}`;
/** The seller's (synthetic) number as typed into the Script Property, and its wa.me digits. */
export const SELLER_DIGITS = ["91", "90000", "000", "99"].join("");
export const SELLER_PROPERTY = `+${SELLER_DIGITS}`;

export const ITEM_HEADERS = ["Item", "Brand", "Category", "Price", "Available from", "Status", "Person", "Notes", "Photo", "ID", "Quantity"];
export const BOOKS_HEADERS = ["Author", "Brand (+ Link)", "Available from", "Status", "Price", "Photos", null, null, "Notes", "Person", "ID", "Quantity"];
export const CLAIM_HEADERS = [
  "Claim ID", "Booking ID", "Item ID", "Item", "Name", "Number", "State", "Created",
  "Promoted at", "Notified", "Sold price", "Sold at", "Ended at", "Message link",
];
export const BOOKING_HEADERS = ["Booking ID", "Token", "Name", "Number", "Created", "Idempotency key", "WhatsApp opened"];
export const STATE_COL = CLAIM_HEADERS.indexOf("State") + 1;

type Row = Record<string, CellValue>;

function addTab(ss: FakeSpreadsheet, name: string, headers: (string | null)[], rows: Row[]): FakeTab {
  return ss.withTab(name, [["Synthetic title row"], [...headers], ...rows.map((r) => headers.map((h) => (h === null ? null : (r[h] ?? null))))]);
}
const item = (id: string, name: string, brand: string, price: number | null, quantity: number): Row => ({
  Item: name, Brand: brand, Price: price, Status: "Stale status", Person: "Stale person", "Available from": "Now", ID: id, Quantity: quantity,
});

export interface SeedClaim {
  id: number; item: string; state?: string; name?: string; number?: CellValue; booking?: number;
  promoted?: string | null; notified?: boolean | null; soldPrice?: number | null; soldAt?: string | null; endedAt?: string | null;
}
export const tokenOf = (booking: number): string => `tok-${String(booking).padStart(4, "0")}`;
export const nameOf = (claimOrBooking: number): string => `Buyer ${claimOrBooking}`;

/** Appends a claim as the handlers would find it (guarded name, apostrophe number). Adds its Bookings row on first use. */
export function seed(ss: FakeSpreadsheet, c: SeedClaim, claimHeaders: string[] = CLAIM_HEADERS): void {
  const booking = c.booking ?? c.id;
  const bookings = ss.getTab("Bookings") as FakeTab;
  if (!bookings.getGrid().some((r) => r[0] === booking)) {
    bookings.appendRow([booking, `'${tokenOf(booking)}`, guardText(c.name ?? nameOf(booking)), `'${e164(booking)}`, "2026-11-01T10:00:00.000Z", `'key-${booking}`, null]);
  }
  const values: Row = {
    "Claim ID": c.id, "Booking ID": booking, "Item ID": c.item, Item: "seed item", Name: guardText(c.name ?? nameOf(booking)),
    Number: c.number === undefined ? `'${e164(booking)}` : c.number, State: c.state ?? "active", Created: "2026-11-01T10:00:00.000Z",
    "Promoted at": c.promoted ?? null, Notified: c.notified ?? null, "Sold price": c.soldPrice ?? null, "Sold at": c.soldAt ?? null,
    "Ended at": c.endedAt ?? null, "Message link": null,
  };
  (ss.getTab("Claims") as FakeTab).appendRow(claimHeaders.map((h) => values[h] ?? null));
}

/**
 * Echo Dot (I-0001, qty 1, Zorbo), Picture frame (I-0002, qty 3), Yoga mat (I-0003, qty 2), Lamp (I-0004, qty 0),
 * Mystery box (I-0008, qty 1), and a Book (I-0006, qty 1, author "Author Q", name "Tiny Atlas").
 */
export function build(claims: SeedClaim[] = [], claimHeaders: string[] = CLAIM_HEADERS): FakeSpreadsheet {
  const ss = new FakeSpreadsheet("Synthetic sale");
  addTab(ss, "Tech", ITEM_HEADERS, [
    item("I-0001", "Echo Dot", "Zorbo", 2500, 1),
    item("I-0002", "Picture frame", "Framex", 200, 3),
    item("I-0003", "Yoga mat", "Kimjaly", 1000, 2),
    item("I-0004", "Lamp", "Glowco", 300, 0),
    item("I-0008", "Mystery box", "Boxco", null, 1),
  ]);
  addTab(ss, "Books", BOOKS_HEADERS, [
    { Author: "Author Q", "Brand (+ Link)": "Tiny Atlas", Status: "Stale status", Person: "Stale person", Price: 90, ID: "I-0006", Quantity: 1 },
  ]);
  ss.withTab("Claims", [[...claimHeaders]]);
  ss.withTab("Bookings", [[...BOOKING_HEADERS]]);
  const todo = ss.withTab("To do", [[...CLAIM_HEADERS]]);
  todo.setFormula(2, 1, "=FILTER(Claims!A2:N, Claims!G2:G=\"active\")");
  for (const c of claims) seed(ss, c, claimHeaders);
  return ss;
}

export function rowsOf(ss: FakeSpreadsheet, tab: string, headerRow = 1): Row[] {
  const [head, ...body] = ss.getTab(tab)!.getGrid().slice(headerRow - 1);
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [String(h), r[i] ?? null])));
}
export const claimRow = (ss: FakeSpreadsheet, id: number): Row => rowsOf(ss, "Claims").find((r) => r["Claim ID"] === id)!;
export const itemRow = (ss: FakeSpreadsheet, tab: string, id: string): Row => rowsOf(ss, tab, 2).find((r) => r["ID"] === id)!;
export const stateOf = (ss: FakeSpreadsheet, id: number) => claimRow(ss, id).State;
export const stamp = (ss: FakeSpreadsheet, id: number) => claimRow(ss, id)["Promoted at"];
export const blank = (v: CellValue | undefined): boolean => v === null || v === undefined || v === "";
export const claimsTab = (ss: FakeSpreadsheet): FakeTab => ss.getTab("Claims") as FakeTab;
export const rowOfClaim = (ss: FakeSpreadsheet, id: number): number => claimsTab(ss).grid.findIndex((r, i) => i > 0 && r[0] === id) + 1;
export const noteOf = (ss: FakeSpreadsheet, id: number): string | null => claimsTab(ss).getNote(rowOfClaim(ss, id), STATE_COL);

export interface Harness {
  ss: FakeSpreadsheet;
  /** In order: "read", "write", "flush", "waitLock", "releaseLock", `cache:<key>`. */
  events: string[];
  /** Lock, cache, clock, siteUrl and sellerWhatsapp, as the Apps Script adapter gives them. */
  deps: Record<string, unknown>;
  /** Sets the claim's State cell as the seller's tap would, then fires the trigger handler. */
  edit: (claimId: number, newState: string, opts?: { oldValue?: CellValue; claimId?: number }) => ReturnType<typeof onClaimsEdit>;
  recalc: () => ReturnType<typeof recalculateAll>;
}

export function harness(ss: FakeSpreadsheet = build(), depsOver: Record<string, unknown> = {}): Harness {
  const events: string[] = [];
  for (const t of ss.tabs) {
    const grid = t.getGrid.bind(t), setCell = t.setCell.bind(t), append = t.appendRow.bind(t), appendRows = t.appendRows.bind(t), setNote = t.setNote.bind(t);
    t.getGrid = () => { events.push("read"); return grid(); };
    t.setCell = (r, c, v) => { events.push("write"); setCell(r, c, v); };
    t.appendRow = (v) => { events.push("write"); append(v); };
    t.appendRows = (rows) => { events.push("write"); appendRows(rows); };
    t.setNote = (r, c, text) => { events.push("write"); setNote(r, c, text); };
  }
  const flush = ss.flush.bind(ss);
  ss.flush = () => { events.push("flush"); flush(); };
  const deps = {
    lock: { waitLock: () => { events.push("waitLock"); }, releaseLock: () => { events.push("releaseLock"); } },
    cache: { remove: (k: string) => { events.push(`cache:${k}`); } },
    now: () => NOW,
    siteUrl: SITE,
    sellerWhatsapp: SELLER_PROPERTY,
    ...depsOver,
  };
  const edit: Harness["edit"] = (claimId, newState, opts = {}) => {
    const claims = claimsTab(ss);
    const head = claims.grid[0]!;
    const idCol = head.indexOf("Claim ID"), stateCol = head.indexOf("State");
    const rowIdx = claims.grid.findIndex((r, i) => i > 0 && r[idCol] === claimId);
    const oldValue = "oldValue" in opts ? opts.oldValue! : claims.grid[rowIdx]![stateCol]!;
    claims.grid[rowIdx]![stateCol] = newState; // direct: the seller's edit is not one of our writes
    const event = { tab: "Claims", row: rowIdx + 1, column: stateCol + 1, oldValue, newValue: newState };
    return onClaimsEdit(ss, "claimId" in opts ? { ...event, claimId: opts.claimId } as never : event, deps as never);
  };
  return { ss, events, deps, edit, recalc: () => recalculateAll(ss, deps as never) };
}
