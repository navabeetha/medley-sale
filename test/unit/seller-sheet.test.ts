// S-15: the seller sheet workflow (brief 2.7, 4.1, 6.1 rules 3, 4, 6, 7, 8; D-003, D-010, D-026, D-030, D-038;
// risk 10.3). Tests run against the in-memory fake sheet. Synthetic data only.
//
// DESIGNED INTERFACE (the spec for src/api/on-edit.ts and src/api/recalc.ts; sync, like the rest of src/api):
//
//   onClaimsEdit(ss: Spreadsheet, edit: ClaimsEdit, deps: SellerDeps): EditResult      // src/api/on-edit.ts
//   recalculateAll(ss: Spreadsheet, deps: SellerDeps): RecalcOutcome                   // src/api/recalc.ts
//
//   ClaimsEdit = { tab: string; row: number; column: number; oldValue: CellValue; newValue: CellValue }
//     What the installable on-edit trigger knows: the sheet's name, the 1-based row and column of the edited cell, and the
//     cell's value before and after. The GRID is authoritative for the new State (the handler re-reads it under the lock);
//     `oldValue` is the only record of the State before the edit (D-026.2: previousRole and canMarkSold use the claims as
//     they were BEFORE the edit, i.e. this claim with State = oldValue). Multi-cell pastes: the adapter should not call
//     onClaimsEdit for them but run recalculateAll instead (adapter wiring, not unit-tested).
//   SellerDeps = {
//     lock:  { waitLock(timeoutMs: number): void; releaseLock(): void };   // shape of ScriptLock, as ReserveDeps
//     cache: { remove(key: string): void };                                // key CATALOGUE_CACHE_KEY
//     now:   () => string;                                                 // ISO timestamp: Promoted at, Sold at
//     siteUrl: string;                                                     // Script Property SITE_URL (trimmed, https, no userinfo,
//   }                                                                      // exactly as reserve's rule: R3 + QA F3)
//
//   EditResult:   { handled: false }                          the edit is not ours (see "Which edits"); nothing written, no lock
//                 { handled: false, error: "busy" }           waitLock threw; nothing written (the timed job repairs it later)
//                 { handled: true, reverted: false }          recalculated and written
//                 { handled: true, reverted: true, reason }   the sale was refused (canMarkSold) and the State put back
//   RecalcOutcome: { ok: true } | { ok: false, error: "busy" | "not-reserving" }   ("not-reserving": no Claims tab; no lock taken)
//
//   Which edits: only an edit to the `State` cell (column found by HEADER NAME in row 1) of a data row (row >= 2) of the
//     `Claims` tab, whose row has a numeric Claim ID. Any other tab, column, the header row, or a row without a Claim ID:
//     { handled: false }, no write, no lock. (Smaller reading: reading the Claims header row before the lock, to find the
//     State column, is tolerated; every write and the data read happen inside the lock.)
//   Lock and order (6.1 rule 6, same pattern as reserve): waitLock -> read -> write -> flush after the LAST write -> cache.remove
//     (CATALOGUE_CACHE_KEY) -> releaseLock; releaseLock in an outer finally, so a throwing write OR a throwing flush still
//     releases it; a throwing releaseLock never changes the result. waitLock gets a timeout > 0. Nothing written: no flush
//     needed, and an ignored edit clears no cache.
//   Recalculation: via src/domain/queue.ts, for the edited claim's ITEM only (onClaimsEdit) or every item (recalculateAll).
//     Claims are found by Claim ID, never by row position (risk 10.3): a sorted Claims tab behaves the same.
//     On an edit: previousRole of each claim = its role in a recalculation of the BEFORE-edit claims (the edited claim with
//     State = oldValue); the AFTER recalculation then decides who was promoted. Written back to Claims for the item's claims:
//       Promoted at = the result's promotedAt (a promoted claim gets now(); a claim no longer a holder gets blank, 6.1.3);
//       a claim that gets a NEW stamp has Notified cleared (so a re-promotion needs a new To do row; D-026 accepted cost).
//     D-026.1 consequences, pinned: releasing a holder stamps the next waiter; releasing a WAITING claim stamps nobody; an
//     undo (released/sold -> active) that lands the claim as a holder stamps it (the other claim loses its stamp).
//   recalculateAll has no event, so no "before": previousRole = each claim's CURRENT role from a read-only recalculation.
//     So it never invents a promotion and never wipes a holder's stamp; it clears stamps on non-holders (smaller reading;
//     the cost is that a promotion whose edit event was missed gets no stamp: see the report).
//   Sale (State -> sold): canMarkSold (before-edit claims) must say ok, else the State cell is put back to oldValue, a note is
//     set on that State cell with the refusal reason, NOTHING else is written for that edit (no Sold at, Status, ...) and the
//     result is { handled: true, reverted: true, reason }. Where the explanation goes (smaller reading): a cell NOTE on the
//     State cell (Tab.setNote, new; brief 6.1.7 says "cell note"). A later accepted edit of that cell removes the note.
//     When accepted: `Sold at` = now() if blank; `Sold price` = the item's Price (a number) if blank (an edited price is
//     kept; no numeric item price -> left blank). Leaving sold (undo): `Sold at` cleared, `Sold price` kept.
//     recalculateAll also fills a blank Sold at / Sold price on sold rows (repairs a missed edit).
//   Item tabs (found by Item ID in the `ID` column, columns by header name: Status, Person), written for the recalculated
//     items only (an item with Quantity 0 or not a whole number is "unavailable": its Status and Person are left alone, D-026.3):
//       Status:  quantity 1:  "Sold" if the unit is sold, "Reserved" if a holder has it, else "Available".
//                quantity >1, nothing sold:  "Available" if a unit has no holder, else "Reserved".
//                quantity >1, some sold:     "<unitsLeft> left, <sold> sold" while units are left, else "Sold".
//                (Only the "2 left, 1 sold" shape is in the brief; the rest is the smaller reading that stays inside the
//                 Available / Reserved / Sold words the migration and the status-mode catalogue already use.)
//       Person:  the Names of the item's sold and holder claims in Claim ID order, joined ", " (waiters are not listed);
//                blank when there are none. Names go through the apostrophe guard (6.3) once, never twice.
//     Cells whose value would not change are not written (so a second recalculateAll writes nothing).
//   Message link (Claims column, per claim row of the recalculated items): for a claim with State active and a Number, the
//     URL "https://wa.me/<buyer digits>?text=<encoded>" whose text mentions the item name and price (e.g. "2,500") and
//     ends with that buyer's private link "<SITE_URL>/#/b/<token>" (token from Bookings by Booking ID, apostrophe removed;
//     trailing "/" on SITE_URL tolerated). Blank when the row has no Number (until the seller adds one and the next
//     recalculation runs), when the Booking has no token, or when SITE_URL is not configured. Other states: not pinned.
//   To do and Sold tabs are FILTER formulas over Claims (src/api/migrate.ts): the handlers never write to them. So "To do
//     lists promoted holders until Notified is ticked" holds because Promoted at and Notified are right on Claims.
//   Never touched by these handlers: Notified (except the reset above), Name, Number, Item, Created, Claim ID, Booking ID.
//   Everything user-controlled that is written stays text-guarded: no written string starts with = + - or @.
//
// NOT covered here, on purpose:
//   - The Apps Script wiring (the installable trigger, ScriptApp, e.range -> ClaimsEdit, CacheService/LockService, the
//     Tab.setNote and SpreadsheetApp parts of the adapter): thin, live-checked at G1. See the report.
//   - Ended at on release, a Quantity edit that leaves more sold than quantity (no revert: the engine clamps unitsLeft at 0).
//
// BUGFIX ROUND (QA 2026-11-06, PM decisions; the block above is the original design, these lines override it):
//   F1  The handler never writes a value that is not a valid State (active / released / sold) into a State cell. When
//       `oldValue` is missing (null / undefined) or not a valid State: NO revert. The edited item is recalculated from the
//       current grid (the new State stands), with each claim's previousRole = its CURRENT role (as recalculateAll, D-039:
//       no stamps invented). Result { handled: true, reverted: false }. If that leaves more units sold than the quantity,
//       a cell note explains it on the edited State cell (6.1.7) but nothing is blanked or reverted.
//   F2  If the grid's State on the edited row is not `newValue` (the seller sorted Claims before the trigger ran), the row
//       is not the edited claim. The handler runs a FULL recalculation of every item under the same single lock (one
//       waitLock, one flush, one cache removal, one release) and answers { handled: true, reverted: false }. It behaves
//       exactly like recalculateAll (previous role = current role): it invents NO promotion, so the waiter who moved up
//       gets no Promoted at. That is the D-039 accepted gap (PM decision); do not infer roles from stale stamps.
//   F3  A new State that is not a valid State: under the lock a note NOT_A_STATE is set on that State cell and NOTHING else
//       is written (no setCell at all). Result stays { handled: false }. The lock is taken, so the write is flushed, the
//       cache cleared and the lock released as for any write. A later accepted edit of the cell removes the note.
//       recalculateAll sets the same note on every State cell holding a non-blank value that is not a valid State (on a row
//       with a Claim ID), clears that note (only that text) on cells that have become valid, leaves other notes alone, and a
//       second run writes nothing.
//   F4  A Number cell holding a JS number with exactly 12 digits starting 91 (Sheets re-typed "+919000000012") is read as
//       "+91..." wherever the Number cell is read: the Message link, and reserve's 20-claim count and booking replay.
//       Text cells are unchanged (normalisePhone is not touched).
//   F5  buildSellerMessage has direct tests (test/unit/seller-message.test.ts); sold / released rows get a blank link.
//   Fake: FakeTab.dropApostrophes (opt-in) reads strings back without ONE leading apostrophe, like real Sheets.
import { describe, expect, it } from "vitest";
import { CATALOGUE_CACHE_KEY } from "../../src/api/handle-get";
import { guardText } from "../../src/api/migrate";
import { onClaimsEdit } from "../../src/api/on-edit";
import { recalculateAll } from "../../src/api/recalc";
import type { CellValue } from "../../src/api/sheet";
import { FakeSpreadsheet, type FakeTab } from "../fixtures/fake-sheet";

// ---- Fixture

const SITE = "https://example.invalid/medley-sale";
const NOW = "2026-11-06T10:00:00.000Z";
const STAMP = "2026-11-02T09:00:00.000Z";

// A synthetic number in the `+91 90000 000xx` style, built in parts for the personal-data scan.
const digits = (n: number): string => ["91", "90000", "000", String(n + 10).padStart(2, "0")].join("");
const e164 = (n: number): string => `+${digits(n)}`;

const ITEM_HEADERS = ["Item", "Brand", "Category", "Price", "Available from", "Status", "Person", "Notes", "Photo", "ID", "Quantity"];
const BOOKS_HEADERS = ["Author", "Brand (+ Link)", "Available from", "Status", "Price", "Photos", null, null, "Notes", "Person", "ID", "Quantity"];
const CLAIM_HEADERS = [
  "Claim ID", "Booking ID", "Item ID", "Item", "Name", "Number", "State", "Created",
  "Promoted at", "Notified", "Sold price", "Sold at", "Ended at", "Message link",
];
const BOOKING_HEADERS = ["Booking ID", "Token", "Name", "Number", "Created", "Idempotency key", "WhatsApp opened"];

function addTab(ss: FakeSpreadsheet, name: string, headers: (string | null)[], rows: Record<string, CellValue>[]): FakeTab {
  return ss.withTab(name, [["Synthetic title row"], [...headers], ...rows.map((r) => headers.map((h) => (h === null ? null : (r[h] ?? null))))]);
}
// Status and Person start as stale text, so a test can see whether the handler rewrote them.
const item = (id: string, name: string, brand: string, price: number | null, quantity: number): Record<string, CellValue> => ({
  Item: name, Brand: brand, Price: price, Status: "Stale status", Person: "Stale person", "Available from": "Now", ID: id, Quantity: quantity,
});

interface SeedClaim {
  id: number; item: string; state?: string; name?: string; number?: CellValue; booking?: number;
  promoted?: string | Date | null; notified?: boolean | null; soldPrice?: number | null; soldAt?: string | null; link?: string | null;
}
const tokenOf = (booking: number): string => `tok-${String(booking).padStart(4, "0")}`;
/** Appends a claim the way the handlers would find it: guarded name and number. Adds its Bookings row on first use. */
function seed(ss: FakeSpreadsheet, c: SeedClaim): void {
  const booking = c.booking ?? c.id;
  const bookings = ss.getTab("Bookings") as FakeTab;
  if (!bookings.getGrid().some((r) => r[0] === booking)) {
    bookings.appendRow([booking, `'${tokenOf(booking)}`, guardText(c.name ?? `Buyer ${c.id}`), `'${e164(c.id)}`, "2026-11-01T10:00:00.000Z", `'key-${booking}`, null]);
  }
  const number = c.number === undefined ? `'${e164(c.id)}` : c.number;
  (ss.getTab("Claims") as FakeTab).appendRow([
    c.id, booking, c.item, "seed item", guardText(c.name ?? `Buyer ${c.id}`), number, c.state ?? "active", "2026-11-01T10:00:00.000Z",
    c.promoted ?? null, c.notified ?? null, c.soldPrice ?? null, c.soldAt ?? null, null, c.link ?? null,
  ]);
}

/** Echo Dot (1), Picture frame (3), Yoga mat (2), Lamp (0, unavailable), a Book (1). To do and Sold are formula tabs, as migrate makes them. */
function build(claims: SeedClaim[] = []): FakeSpreadsheet {
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
  ss.withTab("Claims", [[...CLAIM_HEADERS]]);
  ss.withTab("Bookings", [[...BOOKING_HEADERS]]);
  const todo = ss.withTab("To do", [[...CLAIM_HEADERS]]);
  todo.setFormula(2, 1, "=FILTER(Claims!A2:N, Claims!G2:G=\"active\")");
  const sold = ss.withTab("Sold", [[...CLAIM_HEADERS]]);
  sold.setFormula(2, 1, "=FILTER(Claims!A2:N, Claims!G2:G=\"sold\")");
  for (const c of claims) seed(ss, c);
  return ss;
}

type Row = Record<string, CellValue>;
function rowsOf(ss: FakeSpreadsheet, tab: string, headerRow = 1): Row[] {
  const [head, ...body] = ss.getTab(tab)!.getGrid().slice(headerRow - 1);
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [String(h), r[i] ?? null])));
}
const claimRow = (ss: FakeSpreadsheet, id: number): Row => rowsOf(ss, "Claims").find((r) => r["Claim ID"] === id)!;
/** Item rows of an item tab (header in row 2, under the title row). */
const itemRow = (ss: FakeSpreadsheet, tab: string, id: string): Row => rowsOf(ss, tab, 2).find((r) => r["ID"] === id)!;
const stateOf = (ss: FakeSpreadsheet, id: number) => claimRow(ss, id).State;
const stamp = (ss: FakeSpreadsheet, id: number) => claimRow(ss, id)["Promoted at"];
const blank = (v: CellValue | undefined): boolean => v === null || v === undefined || v === "";

// ---- Harness

interface Harness {
  ss: FakeSpreadsheet;
  events: string[];
  deps: Record<string, unknown>;
  /** Sets the claim's State cell the way the seller's tap would, then fires the trigger handler with the old value. */
  edit: (claimId: number, newState: string, opts?: { oldValue?: CellValue }) => ReturnType<typeof onClaimsEdit>;
  recalc: () => ReturnType<typeof recalculateAll>;
}

function harness(ss: FakeSpreadsheet = build(), depsOver: Record<string, unknown> = {}): Harness {
  const events: string[] = [];
  // Record every sheet access, so ordering against the lock can be asserted.
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
    ...depsOver,
  };
  const edit: Harness["edit"] = (claimId, newState, opts = {}) => {
    const claims = ss.getTab("Claims") as FakeTab;
    const head = claims.grid[0]!;
    const idCol = head.indexOf("Claim ID"), stateCol = head.indexOf("State");
    const rowIdx = claims.grid.findIndex((r, i) => i > 0 && r[idCol] === claimId);
    const oldValue = "oldValue" in opts ? opts.oldValue! : claims.grid[rowIdx]![stateCol]!;
    claims.grid[rowIdx]![stateCol] = newState; // direct, not through setCell: the seller's edit is not one of our writes
    return onClaimsEdit(ss, { tab: "Claims", row: rowIdx + 1, column: stateCol + 1, oldValue, newValue: newState }, deps as never);
  };
  return { ss, events, deps, edit, recalc: () => recalculateAll(ss, deps as never) };
}

const wa = (link: CellValue | undefined) => {
  const u = new URL(String(link));
  return { url: u, text: u.searchParams.get("text") ?? "" };
};

// ---- Which edits are ours

describe("onClaimsEdit: which edits it responds to", () => {
  const ONE = [{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }];

  it("ignores an edit on another tab", () => {
    const h = harness(build(ONE));
    const before = h.ss.snapshot();
    const r = onClaimsEdit(h.ss, { tab: "Tech", row: 3, column: 6, oldValue: "x", newValue: "sold" }, h.deps as never);
    expect(r).toEqual({ handled: false });
    expect(h.events).toEqual([]);
    expect(h.ss.snapshot()).toBe(before);
  });

  it("ignores an edit to a Claims column other than State (Notified, Sold price, ...)", () => {
    const h = harness(build(ONE));
    const before = h.ss.snapshot();
    const notified = CLAIM_HEADERS.indexOf("Notified") + 1;
    expect(onClaimsEdit(h.ss, { tab: "Claims", row: 2, column: notified, oldValue: null, newValue: true }, h.deps as never)).toEqual({ handled: false });
    expect(h.events).not.toContain("waitLock");
    expect(h.events).not.toContain("write");
    expect(h.ss.snapshot()).toBe(before);
  });

  it("ignores an edit to the header row", () => {
    const h = harness(build(ONE));
    const col = CLAIM_HEADERS.indexOf("State") + 1;
    expect(onClaimsEdit(h.ss, { tab: "Claims", row: 1, column: col, oldValue: "State", newValue: "Status" }, h.deps as never)).toEqual({ handled: false });
    expect(h.events).not.toContain("waitLock");
    expect(h.events).not.toContain("write");
  });

  it("ignores an edit to a State cell on a row with no Claim ID", () => {
    const ss = build(ONE);
    (ss.getTab("Claims") as FakeTab).appendRow(CLAIM_HEADERS.map((hd) => (hd === "State" ? "released" : null)));
    const h = harness(ss);
    const col = CLAIM_HEADERS.indexOf("State") + 1;
    expect(onClaimsEdit(h.ss, { tab: "Claims", row: 4, column: col, oldValue: "active", newValue: "released" }, h.deps as never)).toMatchObject({ handled: false });
    expect(h.events).not.toContain("write");
  });

  it("finds the State column by header name: with Claims columns reversed, the State edit still works and the old position is ignored", () => {
    const ss = build(ONE);
    const claims = ss.getTab("Claims") as FakeTab;
    claims.grid = claims.grid.map((r) => [...r].reverse());
    const h = harness(ss);
    const head = claims.grid[0]!;
    const stateCol = head.indexOf("State") + 1;
    const oldPos = CLAIM_HEADERS.indexOf("State") + 1;
    expect(stateCol).not.toBe(oldPos);
    claims.grid[1]![stateCol - 1] = "released";
    expect(onClaimsEdit(h.ss, { tab: "Claims", row: 2, column: stateCol, oldValue: "active", newValue: "released" }, h.deps as never)).toMatchObject({ handled: true });
    expect(rowsOf(ss, "Claims").find((r) => r["Claim ID"] === 2)!["Promoted at"]).toBe(NOW); // the waiter moved up
    h.events.length = 0;
    expect(onClaimsEdit(h.ss, { tab: "Claims", row: 2, column: oldPos, oldValue: "x", newValue: "y" }, h.deps as never)).toEqual({ handled: false });
    expect(h.events).not.toContain("write");
  });
});

// ---- Lock, flush, cache

describe("onClaimsEdit: the script lock (6.1 rule 6)", () => {
  const TWO = [{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }];

  it("takes the lock before any write, reads the claims inside it, flushes after the last write, clears the cache, then releases", () => {
    const h = harness(build(TWO));
    h.edit(1, "released");
    const e = h.events;
    expect(e.indexOf("waitLock")).toBeGreaterThan(-1);
    expect(e.indexOf("write")).toBeGreaterThan(e.indexOf("waitLock"));
    expect(e.slice(e.indexOf("waitLock")).includes("read")).toBe(true);
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    const cache = e.indexOf(`cache:${CATALOGUE_CACHE_KEY}`);
    expect(cache).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(e.indexOf("flush"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(cache);
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("asks for a lock wait of more than 0 ms", () => {
    let asked = -1;
    const h = harness(build(TWO), { lock: { waitLock: (ms: number) => { asked = ms; }, releaseLock: () => {} } });
    h.edit(1, "released");
    expect(asked).toBeGreaterThan(0);
  });

  it("releases the lock when a write throws", () => {
    const h = harness(build(TWO));
    (h.ss.getTab("Claims") as FakeTab).setCell = () => { throw new Error("quota"); };
    try { h.edit(1, "released"); } catch { /* throw or answer: the lock must be freed either way */ }
    expect(h.events.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("releases the lock when flush throws (the R2 pattern)", () => {
    const h = harness(build(TWO));
    h.ss.flush = () => { h.events.push("flush"); throw new Error("Service Spreadsheets failed"); };
    try { h.edit(1, "released"); } catch { /* see above */ }
    expect(h.events.filter((x) => x === "releaseLock")).toHaveLength(1);
    expect(h.events.indexOf("releaseLock")).toBeGreaterThan(h.events.indexOf("flush"));
  });

  it("keeps its result when releaseLock throws", () => {
    const h = harness(build(TWO), { lock: { waitLock: () => {}, releaseLock: () => { throw new Error("lock lost"); } } });
    let r: unknown;
    expect(() => { r = h.edit(1, "released"); }).not.toThrow();
    expect(r).toMatchObject({ handled: true, reverted: false });
    expect(stamp(h.ss, 2)).toBe(NOW);
  });

  it("answers busy and writes nothing when the lock cannot be taken", () => {
    const h = harness(build(TWO), { lock: { waitLock: () => { throw new Error("timeout"); }, releaseLock: () => {} } });
    let r: unknown;
    expect(() => { r = h.edit(1, "released"); }).not.toThrow();
    expect(r).toEqual({ handled: false, error: "busy" });
    expect(h.events).not.toContain("write");
    expect(stamp(h.ss, 2)).toBeNull();
  });
});

// ---- Promotion stamping (D-026, T-02, T-06)

describe("onClaimsEdit: Promoted at follows the queue (6.1 rule 3, D-026, T-02, T-06)", () => {
  it("stamps the waiter who moves up when a holder is released, and nobody else", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0001" }]));
    expect(h.edit(1, "released")).toMatchObject({ handled: true, reverted: false });
    expect(stateOf(h.ss, 1)).toBe("released");
    expect(stamp(h.ss, 2)).toBe(NOW);
    expect(stamp(h.ss, 3)).toBeNull();
    expect(stamp(h.ss, 1)).toBeNull();
  });

  it("stamps nobody when a WAITING claim is released, and keeps the holder's existing stamp (previousRole comes from before the write)", () => {
    const h = harness(build([{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0001" }]));
    h.edit(2, "released");
    expect(stamp(h.ss, 1)).toBe(STAMP);
    expect(stamp(h.ss, 3)).toBeNull(); // moved from 2nd to 1st in line, still waiting
    expect(stamp(h.ss, 2)).toBeNull();
  });

  it("T-02: quantity 3 with 5 claims, the second holder released: the 4th claim becomes holder, the 5th keeps waiting", () => {
    const h = harness(build([1, 2, 3, 4, 5].map((id) => ({ id, item: "I-0002" }))));
    h.edit(2, "released");
    expect(stamp(h.ss, 4)).toBe(NOW);
    expect(stamp(h.ss, 5)).toBeNull();
    expect(stamp(h.ss, 1)).toBeNull();
    expect(stamp(h.ss, 3)).toBeNull();
  });

  it("clears Notified on a freshly stamped claim, so a re-promotion gets a new To do row", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001", notified: true }]));
    h.edit(1, "released");
    expect(stamp(h.ss, 2)).toBe(NOW);
    expect(blank(claimRow(h.ss, 2).Notified) || claimRow(h.ss, 2).Notified === false).toBe(true);
  });

  it("leaves Notified alone on a holder who keeps their place", () => {
    const h = harness(build([{ id: 1, item: "I-0002", promoted: STAMP, notified: true }, { id: 2, item: "I-0002" }, { id: 3, item: "I-0002" }, { id: 4, item: "I-0002" }]));
    h.edit(2, "released");
    expect(claimRow(h.ss, 1).Notified).toBe(true);
    expect(stamp(h.ss, 1)).toBe(STAMP);
  });

  it("T-06: undoing a release returns the claim to its original place and clears Promoted at from the claim that had moved up", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "released" }, { id: 2, item: "I-0001", promoted: STAMP }]));
    h.edit(1, "active", { oldValue: "released" });
    expect(stamp(h.ss, 2)).toBeNull(); // demoted: back to waiting
    expect(itemRow(h.ss, "Tech", "I-0001").Person).toBe("Buyer 1"); // claim 1 is the holder again
    expect(stamp(h.ss, 1)).toBe(NOW); // D-026.1: a restored holder gets a To do row (accepted cost)
  });

  it("T-06: undoing a sale puts the original claim back at the front, and the waiter stays waiting without a stamp", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }]));
    h.edit(1, "active", { oldValue: "sold" });
    expect(stateOf(h.ss, 1)).toBe("active");
    expect(stamp(h.ss, 2)).toBeNull();
    expect(itemRow(h.ss, "Tech", "I-0001").Status).toBe("Reserved");
    expect(itemRow(h.ss, "Tech", "I-0001").Person).toBe("Buyer 1");
  });

  it("finds claims by ID, not row position: with Claims sorted newest first, the right claim is stamped", () => {
    const ss = build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0001" }]);
    const claims = ss.getTab("Claims") as FakeTab;
    claims.grid = [claims.grid[0]!, ...claims.grid.slice(1).reverse()]; // the seller sorted Z to A
    const h = harness(ss);
    h.edit(1, "released");
    expect(stamp(ss, 2)).toBe(NOW);
    expect(stamp(ss, 3)).toBeNull();
    expect(stateOf(ss, 1)).toBe("released");
  });
});

// ---- Selling (T-05, T-07, rule 6.1.7, D-026 note)

describe("onClaimsEdit: setting a claim to sold", () => {
  it("fills Sold at with now() and defaults Sold price to the item's price", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]));
    expect(h.edit(1, "sold")).toMatchObject({ handled: true, reverted: false });
    const c = claimRow(h.ss, 1);
    expect(c.State).toBe("sold");
    expect(c["Sold at"]).toBe(NOW);
    expect(c["Sold price"]).toBe(2500);
  });

  it("is not refused for an ordinary sale of a holder (the check uses the claims from BEFORE the edit, D-026)", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]));
    expect(h.edit(1, "sold")).toMatchObject({ reverted: false });
    expect(stateOf(h.ss, 1)).toBe("sold");
    expect(h.ss.getTab("Claims")!.getGrid()[1]![CLAIM_HEADERS.indexOf("State")]).toBe("sold");
    expect((h.ss.getTab("Claims") as FakeTab).notes).toEqual([]);
  });

  it("keeps a Sold price the seller already typed", () => {
    const h = harness(build([{ id: 1, item: "I-0001", soldPrice: 1800 }]));
    h.edit(1, "sold");
    expect(claimRow(h.ss, 1)["Sold price"]).toBe(1800);
    expect(claimRow(h.ss, 1)["Sold at"]).toBe(NOW);
  });

  it("leaves Sold price blank, without failing, when the item has no numeric price", () => {
    const h = harness(build([{ id: 1, item: "I-0008" }]));
    expect(h.edit(1, "sold")).toMatchObject({ handled: true, reverted: false });
    expect(blank(claimRow(h.ss, 1)["Sold price"])).toBe(true);
    expect(claimRow(h.ss, 1)["Sold at"]).toBe(NOW);
  });

  it("clears Sold at but keeps Sold price when a sale is undone", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 1800, soldAt: STAMP }]));
    h.edit(1, "active", { oldValue: "sold" });
    expect(blank(claimRow(h.ss, 1)["Sold at"])).toBe(true);
    expect(claimRow(h.ss, 1)["Sold price"]).toBe(1800);
  });

  it("sells the holder's unit and leaves the waiters active in line (rule 6.1.8), with no new stamp", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }]));
    h.edit(1, "sold");
    expect(stateOf(h.ss, 2)).toBe("active");
    expect(stamp(h.ss, 2)).toBeNull();
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Sold", Person: "Buyer 1" });
  });

  it("lets the seller sell a WAITING claim (rule 6.1.7), which demotes the last holder and clears that holder's stamp", () => {
    // Yoga mat has 2 units: claims 1 and 2 hold, 3 waits. Selling 3 leaves one unit for the first in line.
    const h = harness(build([{ id: 1, item: "I-0003" }, { id: 2, item: "I-0003", promoted: STAMP }, { id: 3, item: "I-0003" }]));
    expect(h.edit(3, "sold")).toMatchObject({ handled: true, reverted: false });
    expect(stateOf(h.ss, 3)).toBe("sold");
    expect(stamp(h.ss, 2)).toBeNull();
    expect(itemRow(h.ss, "Tech", "I-0003")).toMatchObject({ Status: "1 left, 1 sold", Person: "Buyer 1, Buyer 3" });
  });
});

describe("onClaimsEdit: a sale that would exceed the quantity is reverted with an explanation (T-07, rule 6.1.7)", () => {
  // Echo Dot has 1 unit and claim 1 already bought it; claim 2 is waiting.
  const sold = (): FakeSpreadsheet => build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }]);

  it("puts the State back to the old value and answers reverted with a reason", () => {
    const h = harness(sold());
    const r = h.edit(2, "sold");
    expect(r).toMatchObject({ handled: true, reverted: true });
    expect((r as { reason: string }).reason).toMatch(/already sold/i);
    expect(stateOf(h.ss, 2)).toBe("active");
  });

  it("explains why in a cell note on that State cell (smaller reading of 'cell note')", () => {
    const h = harness(sold());
    h.edit(2, "sold");
    const claims = h.ss.getTab("Claims") as FakeTab;
    const stateCol = CLAIM_HEADERS.indexOf("State") + 1;
    expect(claims.getNote(3, stateCol)).toMatch(/already sold/i);
    expect(claims.notes).toHaveLength(1);
  });

  it("changes nothing else: no Sold at or price on the refused row, the sold claim untouched, Status and Person not rewritten", () => {
    const h = harness(sold());
    h.edit(2, "sold");
    expect(blank(claimRow(h.ss, 2)["Sold at"])).toBe(true);
    expect(blank(claimRow(h.ss, 2)["Sold price"])).toBe(true);
    expect(claimRow(h.ss, 1)).toMatchObject({ State: "sold", "Sold price": 2500, "Sold at": STAMP });
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Stale status", Person: "Stale person" });
    expect(stamp(h.ss, 2)).toBeNull();
  });

  it("still releases the lock, flushes before it, and clears the catalogue cache (the State cell was written)", () => {
    const h = harness(sold());
    h.edit(2, "sold");
    const e = h.events;
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(e.indexOf("flush"));
    expect(e).toContain(`cache:${CATALOGUE_CACHE_KEY}`);
  });

  it("reverts a sale of a released claim too (only an active reservation can be sold)", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "released" }]));
    const r = h.edit(1, "sold", { oldValue: "released" });
    expect(r).toMatchObject({ handled: true, reverted: true });
    expect(stateOf(h.ss, 1)).toBe("released");
  });

  it("reverts when a quantity 2 item already has 2 sold (the second unit is the last)", () => {
    const h = harness(build([
      { id: 1, item: "I-0003", state: "sold" }, { id: 2, item: "I-0003", state: "sold" }, { id: 3, item: "I-0003" },
    ]));
    expect(h.edit(3, "sold")).toMatchObject({ reverted: true });
    expect(stateOf(h.ss, 3)).toBe("active");
  });

  it("removes the explanation note when a later edit of that cell is accepted", () => {
    const h = harness(sold());
    h.edit(2, "sold"); // refused, note set
    h.edit(1, "active", { oldValue: "sold" }); // the seller undoes the other sale
    h.edit(2, "sold"); // now fine
    expect(stateOf(h.ss, 2)).toBe("sold");
    expect((h.ss.getTab("Claims") as FakeTab).notes).toEqual([]);
  });
});

// ---- Status and Person (4.1, criterion 2)

describe("Status and Person are written back to the item tab", () => {
  it("quantity 1 with a holder: Status Reserved, Person the holder's name", () => {
    const h = harness(build([{ id: 1, item: "I-0001", name: "Asha Testperson" }, { id: 2, item: "I-0001", name: "Bela Testperson" }]));
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Asha Testperson" });
  });

  it("quantity 1 with nobody active: Status Available, Person blank", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "released" }]));
    h.recalc();
    const r = itemRow(h.ss, "Tech", "I-0001");
    expect(r.Status).toBe("Available");
    expect(blank(r.Person)).toBe(true);
  });

  it("an item nobody has claimed is Available with a blank Person", () => {
    const h = harness(build());
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0002")).toMatchObject({ Status: "Available" });
    expect(blank(itemRow(h.ss, "Tech", "I-0002").Person)).toBe(true);
  });

  it("quantity 1 sold: Status Sold, Person the buyer; waiters are not listed", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }]));
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Sold", Person: "Buyer 1" });
  });

  it("quantity above 1 with a sale: '2 left, 1 sold', Person lists sold and holder names in Claim ID order", () => {
    const h = harness(build([
      { id: 1, item: "I-0002", state: "sold", soldPrice: 200, soldAt: STAMP }, { id: 2, item: "I-0002" }, { id: 3, item: "I-0002" },
      { id: 4, item: "I-0002" }, // waiting: 3 units, 1 sold, 2 holders
    ]));
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0002")).toMatchObject({ Status: "2 left, 1 sold", Person: "Buyer 1, Buyer 2, Buyer 3" });
  });

  it("quantity above 1, all sold: Status Sold", () => {
    const h = harness(build([1, 2, 3].map((id) => ({ id, item: "I-0002", state: "sold", soldPrice: 200, soldAt: STAMP }))));
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0002")).toMatchObject({ Status: "Sold", Person: "Buyer 1, Buyer 2, Buyer 3" });
  });

  it("quantity above 1, nothing sold: Available while a unit has no holder, Reserved once every unit has one", () => {
    const two = harness(build([1, 2].map((id) => ({ id, item: "I-0002" }))));
    two.recalc();
    expect(itemRow(two.ss, "Tech", "I-0002").Status).toBe("Available");
    const three = harness(build([1, 2, 3].map((id) => ({ id, item: "I-0002" }))));
    three.recalc();
    expect(itemRow(three.ss, "Tech", "I-0002").Status).toBe("Reserved");
  });

  it("finds Status and Person by header name on a tab with a different layout (Books)", () => {
    const h = harness(build([{ id: 1, item: "I-0006", name: "Asha Testperson" }]));
    h.recalc();
    expect(itemRow(h.ss, "Books", "I-0006")).toMatchObject({ Status: "Reserved", Person: "Asha Testperson" });
  });

  it("leaves an unavailable item (quantity 0) alone", () => {
    const h = harness(build([{ id: 1, item: "I-0004" }]));
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0004")).toMatchObject({ Status: "Stale status", Person: "Stale person" });
  });

  it("after an edit, rewrites only the edited claim's item", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }]));
    h.edit(1, "released");
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
    expect(itemRow(h.ss, "Tech", "I-0002")).toMatchObject({ Status: "Stale status", Person: "Stale person" });
  });

  it("keeps a name that starts like a formula as inert text, with one apostrophe", () => {
    const h = harness(build([{ id: 1, item: "I-0001", name: "=HYPERLINK(\"x\")" }]));
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0001").Person).toBe("'=HYPERLINK(\"x\")");
  });

  it("never writes a string that could run as a formula, on any tab", () => {
    const h = harness(build([{ id: 1, item: "I-0001", name: "=EVIL()" }, { id: 2, item: "I-0002", name: "@evil" }, { id: 3, item: "I-0002", name: "-evil" }]));
    h.recalc();
    h.edit(1, "sold");
    const written = h.ss.tabs.flatMap((t) => t.writtenStrings);
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((s) => /^[=+\-@]/.test(s))).toEqual([]);
  });
});

// ---- Message link (criterion 5)

describe("Message link on Claims rows", () => {
  const link = (ss: FakeSpreadsheet, id: number) => claimRow(ss, id)["Message link"];

  it("opens WhatsApp to that buyer with the item details and their private link", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001", booking: 7 }]));
    h.recalc();
    const one = wa(link(h.ss, 1));
    expect(one.url.protocol + "//" + one.url.host).toBe("https://wa.me");
    expect(one.url.pathname).toBe(`/${digits(1)}`);
    expect(one.text).toContain("Echo Dot");
    expect(one.text).toContain("2,500");
    expect(one.text.trimEnd().endsWith(`${SITE}/#/b/${tokenOf(1)}`)).toBe(true);
    const two = wa(link(h.ss, 2)); // a waiting claim, a different booking: its own number and token
    expect(two.url.pathname).toBe(`/${digits(2)}`);
    expect(two.text).toContain(`${SITE}/#/b/${tokenOf(7)}`);
  });

  it("tolerates a trailing slash and stray whitespace on SITE_URL", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]), { siteUrl: ` ${SITE}/ \n` });
    h.recalc();
    expect(wa(link(h.ss, 1)).text.trimEnd().endsWith(`${SITE}/#/b/${tokenOf(1)}`)).toBe(true);
  });

  it("is written after an edit, for the claims of the edited item", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }]));
    h.edit(1, "released");
    expect(wa(link(h.ss, 2)).url.pathname).toBe(`/${digits(2)}`);
  });

  it("stays blank for a row with no number, then fills in once the seller adds one and the next recalculation runs", () => {
    const h = harness(build([{ id: 1, item: "I-0001", number: null }]));
    h.recalc();
    expect(blank(link(h.ss, 1))).toBe(true);
    const claims = h.ss.getTab("Claims") as FakeTab;
    claims.grid[1]![CLAIM_HEADERS.indexOf("Number")] = e164(1); // typed by the seller, unguarded
    h.recalc();
    expect(wa(link(h.ss, 1)).url.pathname).toBe(`/${digits(1)}`);
  });

  it("clears a link whose number has since been removed", () => {
    const h = harness(build([{ id: 1, item: "I-0001", number: null, link: "https://wa.me/1?text=old" }]));
    h.recalc();
    expect(blank(link(h.ss, 1))).toBe(true);
  });

  it("is blank, while everything else still updates, when SITE_URL is not configured", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]), { siteUrl: "http://example.invalid" });
    expect(h.recalc()).toEqual({ ok: true });
    expect(blank(link(h.ss, 1))).toBe(true);
    expect(itemRow(h.ss, "Tech", "I-0001").Status).toBe("Reserved");
  });

  it("is blank when the booking has no token to link to", () => {
    const ss = build([{ id: 1, item: "I-0001" }]);
    (ss.getTab("Bookings") as FakeTab).grid[1]![1] = null;
    const h = harness(ss);
    h.recalc();
    expect(blank(link(ss, 1))).toBe(true);
  });
});

// ---- To do and Sold tabs

describe("To do and Sold tabs", () => {
  it("are never written by the handlers: they are FILTER formulas over Claims", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002" }]));
    const frozen = () => JSON.stringify(["To do", "Sold"].map((n) => ({ g: (h.ss.getTab(n) as FakeTab).grid, f: (h.ss.getTab(n) as FakeTab).formulas })));
    const before = frozen();
    h.edit(1, "released");
    h.edit(3, "sold");
    h.recalc();
    expect(frozen()).toBe(before);
  });

  it("leaves the facts the To do filter reads in place: a promoted, un-notified holder is State active with a Promoted at and a blank Notified", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }]));
    h.edit(1, "released");
    const c = claimRow(h.ss, 2);
    expect(c.State).toBe("active");
    expect(c["Promoted at"]).toBe(NOW);
    expect(c.Notified === true).toBe(false);
  });

  it("gives a sold row a numeric Sold price so the Sold totals add up", () => {
    const h = harness(build([{ id: 1, item: "I-0002" }, { id: 2, item: "I-0001", soldPrice: 1800 }]));
    h.edit(1, "sold");
    h.edit(2, "sold");
    expect(typeof claimRow(h.ss, 1)["Sold price"]).toBe("number");
    expect(claimRow(h.ss, 2)["Sold price"]).toBe(1800);
  });
});

// ---- The timed job

describe("recalculateAll (the 10-minute repair job)", () => {
  it("runs under the lock like any write: lock first, flush after the last write, cache cleared, lock released", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]));
    expect(h.recalc()).toEqual({ ok: true });
    const e = h.events;
    expect(e.indexOf("waitLock")).toBeLessThan(e.indexOf("write"));
    expect(e.slice(0, e.indexOf("waitLock")).filter((x) => x === "read" || x === "write")).toEqual([]);
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf(`cache:${CATALOGUE_CACHE_KEY}`)).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(e.indexOf("flush"));
  });

  it("releases the lock when a write or the flush throws", () => {
    const a = harness(build([{ id: 1, item: "I-0001" }]));
    (a.ss.getTab("Tech") as FakeTab).setCell = () => { throw new Error("quota"); };
    try { a.recalc(); } catch { /* ok */ }
    expect(a.events.filter((x) => x === "releaseLock")).toHaveLength(1);
    const b = harness(build([{ id: 1, item: "I-0001" }]));
    b.ss.flush = () => { b.events.push("flush"); throw new Error("boom"); };
    try { b.recalc(); } catch { /* ok */ }
    expect(b.events.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("answers busy and writes nothing when the lock cannot be taken", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]), { lock: { waitLock: () => { throw new Error("timeout"); }, releaseLock: () => {} } });
    expect(h.recalc()).toEqual({ ok: false, error: "busy" });
    expect(h.events).not.toContain("write");
  });

  it("does nothing, and takes no lock, when the spreadsheet has no Claims tab (status mode)", () => {
    const ss = new FakeSpreadsheet("Synthetic sale");
    addTab(ss, "Tech", ITEM_HEADERS, [item("I-0001", "Echo Dot", "Zorbo", 2500, 1)]);
    const h = harness(ss);
    const before = ss.snapshot();
    expect(h.recalc()).toEqual({ ok: false, error: "not-reserving" });
    expect(h.events).not.toContain("waitLock");
    expect(ss.snapshot()).toBe(before);
  });

  it("repairs a missed edit on every item: Status, Person and Message link are rewritten", () => {
    // The seller released claim 1 on a phone and the trigger never fired: Status and Person are stale.
    const h = harness(build([
      { id: 1, item: "I-0001", state: "released" }, { id: 2, item: "I-0001" },
      { id: 3, item: "I-0002", state: "sold", soldPrice: 200, soldAt: STAMP },
    ]));
    h.recalc();
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
    expect(itemRow(h.ss, "Tech", "I-0002")).toMatchObject({ Status: "2 left, 1 sold", Person: "Buyer 3" });
    expect(wa(claimRow(h.ss, 2)["Message link"]).url.pathname).toBe(`/${digits(2)}`);
  });

  it("fills a blank Sold at and Sold price on a sold row whose edit was missed, and keeps an edited price", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold" }, { id: 2, item: "I-0002", state: "sold", soldPrice: 150 }]));
    h.recalc();
    expect(claimRow(h.ss, 1)["Sold price"]).toBe(2500);
    expect(claimRow(h.ss, 1)["Sold at"]).toBe(NOW);
    expect(claimRow(h.ss, 2)["Sold price"]).toBe(150);
  });

  it("does not invent promotions: unstamped holders stay unstamped and a holder keeps an existing stamp", () => {
    const h = harness(build([
      { id: 1, item: "I-0001" }, { id: 2, item: "I-0001" },
      { id: 3, item: "I-0002", promoted: STAMP, notified: true }, { id: 4, item: "I-0002" },
    ]));
    h.recalc();
    expect(stamp(h.ss, 1)).toBeNull();
    expect(stamp(h.ss, 2)).toBeNull();
    expect(stamp(h.ss, 3)).toBe(STAMP);
    expect(claimRow(h.ss, 3).Notified).toBe(true);
    expect(stamp(h.ss, 4)).toBeNull();
  });

  it("clears a stale Promoted at from a claim that is not a holder (rule 6.1.3)", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001", promoted: STAMP }]));
    h.recalc();
    expect(stamp(h.ss, 2)).toBeNull();
  });

  it("is stable: a second run writes nothing", () => {
    const h = harness(build([
      { id: 1, item: "I-0001", state: "sold" }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002" }, { id: 4, item: "I-0006" },
    ]));
    h.recalc();
    const after = h.ss.snapshot();
    h.events.length = 0;
    expect(h.recalc()).toEqual({ ok: true });
    expect(h.ss.snapshot()).toBe(after);
    expect(h.events).not.toContain("write");
  });

  it("works on a sorted Claims tab: same result as unsorted", () => {
    const claims = [{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002" }];
    const plain = harness(build(claims));
    plain.recalc();
    const ss = build(claims);
    const t = ss.getTab("Claims") as FakeTab;
    t.grid = [t.grid[0]!, ...t.grid.slice(1).reverse()];
    const sorted = harness(ss);
    sorted.recalc();
    expect(itemRow(ss, "Tech", "I-0001")).toEqual(itemRow(plain.ss, "Tech", "I-0001"));
    expect(itemRow(ss, "Tech", "I-0002")).toEqual(itemRow(plain.ss, "Tech", "I-0002"));
    expect(wa(claimRow(ss, 2)["Message link"]).url.pathname).toBe(`/${digits(2)}`);
  });
});

// ======================================================================================================
// BUGFIX ROUND (QA 2026-11-06). See the "BUGFIX ROUND" lines in the DESIGNED INTERFACE block at the top.
// ======================================================================================================

const STATE_COL = CLAIM_HEADERS.indexOf("State") + 1;
/** The wording of the note on a State cell that holds something other than active / released / sold (F3, pinned). */
const NOT_A_STATE = "Not a valid state — choose active, released or sold";
const LATER = "2026-11-07T08:00:00.000Z";

const claimsTab = (ss: FakeSpreadsheet): FakeTab => ss.getTab("Claims") as FakeTab;
/** 1-based sheet row of a claim, wherever a sort has put it. */
const rowOfClaim = (ss: FakeSpreadsheet, id: number): number => claimsTab(ss).grid.findIndex((r, i) => i > 0 && r[0] === id) + 1;
const noteOf = (ss: FakeSpreadsheet, id: number): string | null => claimsTab(ss).getNote(rowOfClaim(ss, id), STATE_COL);
/** Every value written into the State column through setCell from now on. */
function watchStateWrites(ss: FakeSpreadsheet): CellValue[] {
  const t = claimsTab(ss);
  const writes: CellValue[] = [];
  const orig = t.setCell.bind(t);
  t.setCell = (r, c, v) => { if (c === STATE_COL) writes.push(v); orig(r, c, v); };
  return writes;
}

// ---- F1 (S2): an edit event without a usable oldValue must never blank or revert the State

describe("onClaimsEdit: an oldValue that is missing or not a valid State (QA F1)", () => {
  // Quantity 1: claim 1 holds, claim 2 waits.
  const QUEUE = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }];

  for (const [label, oldValue] of [["null", null], ["undefined", undefined], ["an empty string", ""], ["a typo'd State", "Sold "]] as const) {
    it(`keeps a sale whose oldValue is ${label}: the new State stands, the waiter stays waiting, nothing is blanked`, () => {
      const h = harness(build(QUEUE));
      const writes = watchStateWrites(h.ss);
      const r = h.edit(1, "sold", { oldValue: oldValue as CellValue });
      expect(r).toEqual({ handled: true, reverted: false });
      expect(stateOf(h.ss, 1)).toBe("sold");
      expect(stateOf(h.ss, 2)).toBe("active");
      expect(stamp(h.ss, 2)).toBeNull(); // the unit is sold, so the waiter is not promoted
      expect(writes.filter((v) => v !== "sold" && v !== "active" && v !== "released")).toEqual([]); // never a non-State value
      expect(writes).toEqual([]); // the seller's own edit already put "sold" there; there is nothing to write back
      expect(noteOf(h.ss, 1)).toBeNull(); // one sold unit of one: no oversell, no note
    });
  }

  it("recalculates the edited item from the grid: Status, Person, Sold at and Sold price follow the new State", () => {
    const h = harness(build(QUEUE));
    h.edit(1, "sold", { oldValue: null });
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Sold", Person: "Buyer 1" });
    expect(claimRow(h.ss, 1)).toMatchObject({ "Sold at": NOW, "Sold price": 2500 });
  });

  it("does not invent a promotion when there was no oldValue: releasing the holder stamps nobody (as the timed job)", () => {
    const h = harness(build(QUEUE));
    const r = h.edit(1, "released", { oldValue: null });
    expect(r).toEqual({ handled: true, reverted: false });
    expect(stateOf(h.ss, 1)).toBe("released");
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
    expect(stamp(h.ss, 2)).toBeNull();
  });

  it("when the missing oldValue leaves more sold than the quantity, keeps both sales and explains it in a note on the edited State cell", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }]));
    const writes = watchStateWrites(h.ss);
    const r = h.edit(2, "sold", { oldValue: null });
    expect(r).toEqual({ handled: true, reverted: false });
    expect(stateOf(h.ss, 1)).toBe("sold");
    expect(stateOf(h.ss, 2)).toBe("sold"); // not reverted, not blanked
    expect(writes).toEqual([]);
    const note = noteOf(h.ss, 2);
    expect(note).not.toBeNull();
    expect(note!.length).toBeGreaterThan(0);
    expect(itemRow(h.ss, "Tech", "I-0001").Status).toBe("Sold");
    expect(claimRow(h.ss, 1)["Sold at"]).toBe(STAMP); // the earlier sale is untouched
  });

  it("a missing oldValue on a sale that fits leaves no note, and removes an older one", () => {
    const h = harness(build(QUEUE));
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 1), STATE_COL, "old refusal");
    h.edit(1, "sold", { oldValue: null });
    expect(noteOf(h.ss, 1)).toBeNull();
  });

  it("still flushes, clears the cache and releases the lock once", () => {
    const h = harness(build(QUEUE));
    h.edit(1, "sold", { oldValue: null });
    const e = h.events;
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e).toContain(`cache:${CATALOGUE_CACHE_KEY}`);
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
  });
});

// ---- F2 (S3): a sort between the edit and the trigger run

describe("onClaimsEdit: Claims re-sorted before the trigger ran (QA F2)", () => {
  // Item A (I-0001, quantity 1): claim 1 holds (stamped), claim 2 waits. Item B (I-0002, quantity 3): claim 3 holds (stamped).
  const SEED = [
    { id: 1, item: "I-0001", promoted: STAMP, notified: true }, { id: 2, item: "I-0001" },
    { id: 3, item: "I-0002", promoted: STAMP, notified: true },
  ];

  /** The seller releases claim 1, sorts Claims by Claim ID descending, THEN the trigger runs with the pre-sort row number. */
  function releaseThenSort(h: Harness, over: Partial<{ newValue: CellValue }> = {}) {
    const t = claimsTab(h.ss);
    const row = rowOfClaim(h.ss, 1);
    t.grid[row - 1]![STATE_COL - 1] = "released";
    t.grid = [t.grid[0]!, ...t.grid.slice(1).sort((a, b) => Number(b[0]) - Number(a[0]))];
    expect(t.grid[row - 1]![0]).toBe(3); // the edited row now holds claim 3 (item B): the premise of the test
    return onClaimsEdit(h.ss, { tab: "Claims", row, column: STATE_COL, oldValue: "active", newValue: "released", ...over }, h.deps as never);
  }

  it("repairs the item that really changed (Status, Person) and, like recalculateAll, stamps nobody (D-039 accepted gap)", () => {
    const h = harness(build(SEED));
    const r = releaseThenSort(h);
    expect(r).toEqual({ handled: true, reverted: false });
    expect(stateOf(h.ss, 1)).toBe("released");
    expect(stamp(h.ss, 2)).toBeNull(); // D-039: a repair with no before-state invents no promotion
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
  });

  it("is a full repair: the other item is recalculated too, and its holder keeps stamp and Notified", () => {
    const h = harness(build(SEED));
    releaseThenSort(h);
    expect(itemRow(h.ss, "Tech", "I-0002")).toMatchObject({ Status: "Available", Person: "Buyer 3" }); // not the stale text
    expect(stateOf(h.ss, 3)).toBe("active");
    expect(stamp(h.ss, 3)).toBe(STAMP);
    expect(claimRow(h.ss, 3).Notified).toBe(true);
  });

  it("does the repair under ONE lock: a single waitLock, flush after the last write, cache cleared, a single release", () => {
    const h = harness(build(SEED));
    releaseThenSort(h);
    const e = h.events;
    expect(e.filter((x) => x === "waitLock")).toHaveLength(1);
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
    expect(e.indexOf("write")).toBeGreaterThan(e.indexOf("waitLock"));
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf(`cache:${CATALOGUE_CACHE_KEY}`)).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(e.indexOf("flush"));
  });

  it("answers busy and writes nothing when the lock cannot be taken", () => {
    const h = harness(build(SEED), { lock: { waitLock: () => { throw new Error("timeout"); }, releaseLock: () => {} } });
    expect(releaseThenSort(h)).toEqual({ handled: false, error: "busy" });
    expect(h.events).not.toContain("write");
    expect(stamp(h.ss, 2)).toBeNull();
  });

  it("does not treat the row's new occupant as the edited claim: no sale check, no note, no revert on it", () => {
    const h = harness(build(SEED));
    const writes = watchStateWrites(h.ss);
    releaseThenSort(h);
    expect(writes).toEqual([]);
    expect(claimsTab(h.ss).notes).toEqual([]);
  });

  it("a sort that leaves the edited claim on its row is an ordinary edit (grid State equals newValue)", () => {
    const h = harness(build(SEED));
    const r = h.edit(1, "released");
    expect(r).toEqual({ handled: true, reverted: false });
    expect(stamp(h.ss, 2)).toBe(NOW);
    expect(itemRow(h.ss, "Tech", "I-0002").Status).toBe("Stale status"); // only the edited item is rewritten
  });
});

// ---- F3 (S3): a typo'd State

describe("onClaimsEdit: a new State that is not a valid State (QA F3)", () => {
  const TWO = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }];

  it("puts an explanatory note on that State cell and answers handled:false", () => {
    const h = harness(build(TWO));
    const r = h.edit(1, "Sold ");
    expect(r).toEqual({ handled: false });
    expect(noteOf(h.ss, 1)).toBe(NOT_A_STATE);
  });

  it("writes nothing else: no cell value on any tab, no promotion, Status and Person left alone", () => {
    const h = harness(build(TWO));
    const before = h.ss.tabs.map((t) => JSON.stringify(t.grid));
    h.ss.tabs.forEach((t) => { t.writtenStrings = []; }); // the seed went through appendRow; count only what the handler writes
    h.edit(1, "Sold ");
    const after = h.ss.tabs.map((t) => JSON.stringify(t.grid));
    // The only change is the seller's own typo in the State cell (the harness put it there, not a handler write).
    const typoGrid = JSON.parse(before[h.ss.tabs.indexOf(claimsTab(h.ss))]!) as CellValue[][];
    typoGrid[rowOfClaim(h.ss, 1) - 1]![STATE_COL - 1] = "Sold ";
    expect(after[h.ss.tabs.indexOf(claimsTab(h.ss))]).toBe(JSON.stringify(typoGrid));
    h.ss.tabs.forEach((t, i) => { if (t !== claimsTab(h.ss)) expect(after[i]).toBe(before[i]); });
    expect(h.ss.tabs.flatMap((t) => t.writtenStrings)).toEqual([]);
    expect(stamp(h.ss, 2)).toBeNull();
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Stale status", Person: "Stale person" });
    expect(claimsTab(h.ss).notes).toHaveLength(1);
  });

  it("writes the note under the lock, then flushes, clears the cache and releases (the note is a write)", () => {
    const h = harness(build(TWO));
    h.edit(1, "Sold ");
    const e = h.events;
    expect(e.indexOf("write")).toBeGreaterThan(e.indexOf("waitLock"));
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf(`cache:${CATALOGUE_CACHE_KEY}`)).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(e.indexOf("flush"));
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("writes no note when the lock cannot be taken (busy)", () => {
    const h = harness(build(TWO), { lock: { waitLock: () => { throw new Error("timeout"); }, releaseLock: () => {} } });
    expect(h.edit(1, "Sold ")).toEqual({ handled: false, error: "busy" });
    expect(claimsTab(h.ss).notes).toEqual([]);
    expect(h.events).not.toContain("write");
  });

  it("removes the note when the seller then picks a valid State (whose oldValue is the typo)", () => {
    const h = harness(build(TWO));
    h.edit(1, "Sold ");
    expect(noteOf(h.ss, 1)).toBe(NOT_A_STATE);
    const r = h.edit(1, "sold", { oldValue: "Sold " });
    expect(r).toEqual({ handled: true, reverted: false });
    expect(noteOf(h.ss, 1)).toBeNull();
    expect(stateOf(h.ss, 1)).toBe("sold");
  });

  it("leaves a different, valid State cell alone: a typo on claim 1 puts no note on claim 2", () => {
    const h = harness(build(TWO));
    h.edit(1, "Sold ");
    expect(noteOf(h.ss, 2)).toBeNull();
  });
});

describe("recalculateAll: typo'd State cells (QA F3)", () => {
  const SEED = [{ id: 1, item: "I-0001", state: "Sold " }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002", state: "Released" }];

  it("notes every typo'd State cell it sees", () => {
    const h = harness(build(SEED));
    h.recalc();
    expect(noteOf(h.ss, 1)).toBe(NOT_A_STATE);
    expect(noteOf(h.ss, 3)).toBe(NOT_A_STATE);
    expect(noteOf(h.ss, 2)).toBeNull();
  });

  it("does not change the typo'd cell's value, and the rest of the repair still happens", () => {
    const h = harness(build(SEED));
    h.recalc();
    expect(stateOf(h.ss, 1)).toBe("Sold ");
    expect(stateOf(h.ss, 3)).toBe("Released");
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
  });

  it("is stable: a second run writes nothing, notes included", () => {
    const h = harness(build(SEED));
    h.recalc();
    const after = h.ss.snapshot();
    h.events.length = 0;
    h.recalc();
    expect(h.ss.snapshot()).toBe(after);
    expect(h.events).not.toContain("write");
  });

  it("clears the typo note once the cell holds a valid State, and leaves other notes (a refused-sale reason) alone", () => {
    const h = harness(build(SEED));
    h.recalc();
    claimsTab(h.ss).grid[rowOfClaim(h.ss, 1) - 1]![STATE_COL - 1] = "sold"; // the seller fixes the typo
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, "Already sold: the last unit is gone"); // an unrelated note
    h.recalc();
    expect(noteOf(h.ss, 1)).toBeNull();
    expect(noteOf(h.ss, 2)).toBe("Already sold: the last unit is gone");
    expect(noteOf(h.ss, 3)).toBe(NOT_A_STATE); // still a typo
  });

  it("does not note blank-ID rows or valid States on a sheet with no typos", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001", state: "released" }]));
    h.recalc();
    expect(claimsTab(h.ss).notes).toEqual([]);
  });
});

// ---- F4 (S3): a Number that Sheets stored as a number

describe("Message link: a Number cell that holds a number (QA F4)", () => {
  const NUM = Number(digits(2)); // 919000000012: what Sheets makes of a typed "+919000000012"

  it("reads a numeric 12-digit 91... Number as +91..., so the link opens that buyer's chat (recalculateAll)", () => {
    const h = harness(build([{ id: 1, item: "I-0001", number: NUM }]));
    h.recalc();
    const link = claimRow(h.ss, 1)["Message link"];
    expect(blank(link)).toBe(false);
    expect(wa(link).url.pathname).toBe(`/${digits(2)}`);
    expect(wa(link).text).toContain(`${SITE}/#/b/${tokenOf(1)}`);
  });

  it("and after an edit of the item", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001", number: NUM }]));
    h.edit(1, "released");
    expect(wa(claimRow(h.ss, 2)["Message link"]).url.pathname).toBe(`/${digits(2)}`);
  });

  it("does not write the buyer's digits anywhere but the link path", () => {
    const h = harness(build([{ id: 1, item: "I-0001", number: NUM }]));
    h.recalc();
    expect(wa(claimRow(h.ss, 1)["Message link"]).text).not.toContain(digits(2));
  });

  it("a numeric 10-digit Number still works (already supported)", () => {
    const h = harness(build([{ id: 1, item: "I-0001", number: Number(digits(2).slice(2)) }]));
    h.recalc();
    expect(wa(claimRow(h.ss, 1)["Message link"]).url.pathname).toBe(`/${digits(2)}`);
  });

  it("does not guess at other numbers: a 12-digit number that does not start with 91, or an 11-digit one that does, gets no link", () => {
    for (const bad of [Number(["44", "90000", "000", "12"].join("")), Number(["91", "90000", "0012"].join(""))]) {
      const h = harness(build([{ id: 1, item: "I-0001", number: bad }]));
      h.recalc();
      expect(blank(claimRow(h.ss, 1)["Message link"]), String(bad)).toBe(true);
    }
  });

  it("only a number cell is repaired: the same digits typed as text stay unlinked (normalisePhone is unchanged for text)", () => {
    const h = harness(build([{ id: 1, item: "I-0001", number: digits(2) }]));
    h.recalc();
    expect(blank(claimRow(h.ss, 1)["Message link"])).toBe(true);
  });
});

// ---- F5 (S4): which rows get a Message link, and what it says

describe("Message link: wording by role and state (QA F5)", () => {
  it("tells a waiter their place in line, never that they hold the item", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0001" }]));
    h.recalc();
    const holder = wa(claimRow(h.ss, 1)["Message link"]).text, second = wa(claimRow(h.ss, 3)["Message link"]).text;
    expect(holder).toContain("is reserved for you");
    expect(second).toContain("You are 2nd in line");
    expect(second).not.toContain("reserved for you");
  });

  it("a newline in the buyer's name cannot add lines to the message", () => {
    const h = harness(build([{ id: 1, item: "I-0001", name: "Asha\nTest\r\nPerson" }]));
    h.recalc();
    const text = wa(claimRow(h.ss, 1)["Message link"]).text;
    expect(text.split("\n")[0]).toBe("Hi Asha Test Person!");
    expect(text.split("\n")).toHaveLength(4);
  });

  it("clears the link of a sold or released row, whatever was there, on a recalculation and on an edit", () => {
    const stale = "https://wa.me/1?text=stale";
    const h = harness(build([
      { id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP, link: stale },
      { id: 2, item: "I-0002", state: "released", link: stale }, { id: 3, item: "I-0002", link: stale },
    ]));
    h.recalc();
    expect(blank(claimRow(h.ss, 1)["Message link"])).toBe(true);
    expect(blank(claimRow(h.ss, 2)["Message link"])).toBe(true);
    expect(blank(claimRow(h.ss, 3)["Message link"])).toBe(false);
    h.edit(3, "released");
    expect(blank(claimRow(h.ss, 3)["Message link"])).toBe(true);
  });
});

// ---- Coverage gaps from the QA report

describe("stability and ordering (QA coverage gaps)", () => {
  it("a name guarded with an apostrophe is not rewritten when Sheets reads it back without the apostrophe", () => {
    const ss = build([{ id: 1, item: "I-0001", name: "=Evil()" }, { id: 2, item: "I-0001", name: "+Other" }]);
    const h = harness(ss);
    h.recalc();
    expect(itemRow(ss, "Tech", "I-0001").Person).toBe("'=Evil()"); // stored with the guard
    for (const t of ss.tabs) (t as FakeTab).dropApostrophes = true; // from now on, read like real Sheets
    expect(itemRow(ss, "Tech", "I-0001").Person).toBe("=Evil()"); // premise of the test: the fake now drops it
    h.events.length = 0;
    const after = ss.snapshot();
    h.recalc();
    expect(h.events).not.toContain("write");
    expect(ss.snapshot()).toBe(after);
  });

  it("recalculateAll keeps an existing Sold at, even when the clock has moved on", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }]), { now: () => LATER });
    h.recalc();
    expect(claimRow(h.ss, 1)["Sold at"]).toBe(STAMP);
  });

  it("an edit elsewhere on the item keeps an existing Sold at", () => {
    const h = harness(build([{ id: 1, item: "I-0002", state: "sold", soldPrice: 200, soldAt: STAMP }, { id: 2, item: "I-0002" }]), { now: () => LATER });
    h.edit(2, "released");
    expect(claimRow(h.ss, 1)["Sold at"]).toBe(STAMP);
  });

  it("a Promoted at that reads back as a Date is left as it is by recalculateAll and by an edit (no rewrite, Notified kept)", () => {
    const h = harness(build([{ id: 1, item: "I-0001", promoted: new Date(STAMP), notified: true }, { id: 2, item: "I-0001" }]));
    const col = CLAIM_HEADERS.indexOf("Promoted at");
    const cell = () => claimsTab(h.ss).grid[rowOfClaim(h.ss, 1) - 1]![col];
    const original = cell();
    expect(original).toBeInstanceOf(Date);
    h.recalc();
    h.edit(2, "released");
    expect(cell()).toBe(original); // the very same Date object: never rewritten
    expect(claimRow(h.ss, 1).Notified).toBe(true);
    expect(stamp(h.ss, 2)).toBeNull();
  });

  it("Person follows Claim ID order on a sorted Claims tab (recalculateAll and an edit)", () => {
    const seedClaims = [{ id: 1, item: "I-0002" }, { id: 2, item: "I-0002" }, { id: 3, item: "I-0002" }];
    for (const how of ["recalc", "edit"] as const) {
      const ss = build([...seedClaims, { id: 4, item: "I-0001" }]);
      const t = claimsTab(ss);
      t.grid = [t.grid[0]!, ...t.grid.slice(1).reverse()]; // Z to A
      const h = harness(ss);
      if (how === "recalc") h.recalc(); else h.edit(4, "released");
      expect(itemRow(ss, "Tech", "I-0002").Person, how).toBe(how === "recalc" ? "Buyer 1, Buyer 2, Buyer 3" : "Stale person");
      if (how === "edit") { h.edit(2, "released"); expect(itemRow(ss, "Tech", "I-0002").Person).toBe("Buyer 1, Buyer 3"); }
    }
  });

  it("a formula-like name that is not first in Person is still written as inert text; each name is guarded once, not per name", () => {
    const h = harness(build([
      { id: 1, item: "I-0002", name: "Asha" }, { id: 2, item: "I-0002", name: "=EVIL()" }, { id: 3, item: "I-0002", name: "@evil" },
    ]));
    h.recalc();
    const person = String(itemRow(h.ss, "Tech", "I-0002").Person);
    expect(person).toBe("Asha, =EVIL(), @evil"); // starts with a letter, so it cannot run; no apostrophe inside
    expect(h.ss.tabs.flatMap((t) => t.writtenStrings).filter((s) => /^[=+\-@]/.test(s))).toEqual([]);
    const h2 = harness(build([{ id: 1, item: "I-0002", name: "=A" }, { id: 2, item: "I-0002", name: "=B" }]));
    h2.recalc();
    expect(itemRow(h2.ss, "Tech", "I-0002").Person).toBe("'=A, =B"); // one guard on the whole text
  });

  it("waits for the lock for the documented 30 seconds, on an edit and on the timed job", () => {
    const asked: number[] = [];
    const lock = { waitLock: (ms: number) => { asked.push(ms); }, releaseLock: () => {} };
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }]), { lock });
    h.edit(1, "released");
    h.recalc();
    expect(asked).toEqual([30_000, 30_000]);
  });
});
