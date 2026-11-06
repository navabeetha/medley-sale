// S-11: the reserve API (brief 4.3, 6.1 rule 6, 6.3, 2.8; D-005, D-008, D-011,
// D-026, D-030, D-036, D-038). Tests run against the in-memory fake sheet.
//
// DESIGNED INTERFACE (the spec for src/api/reserve.ts; sync, like the rest of src/api):
//
//   reserve(ss: Spreadsheet, request: unknown, deps: ReserveDeps): ReserveResponse
//
//   ReserveDeps = {
//     lock:  { waitLock(timeoutMs: number): void; releaseLock(): void };  // shape of Apps Script's ScriptLock
//     cache: { remove(key: string): void };               // CacheService; key is CATALOGUE_CACHE_KEY
//     randomBytes: (n: number) => Uint8Array;              // as MigrateOptions; adapter feeds uuidsToBytes (D-005)
//     now: () => string;                                   // ISO timestamp for Created / Promoted at
//     sellerWhatsapp?: string;                             // Script Property SELLER_WHATSAPP (same rules as D-036.2)
//     siteUrl: string;                                     // Script Property SITE_URL; must be an absolute https:// URL
//                                                          // (a trailing "/" is tolerated), else "not-configured"
//   }
//
//   Spreadsheet (src/api/sheet.ts) gains, for the QA findings round (F1, F2):
//     Tab.appendRows(rows: CellValue[][]): void      // ONE batched write (setValues in the adapter), all-or-nothing
//     Spreadsheet.flush(): void                      // SpreadsheetApp.flush() in the adapter (not unit-testable: live check)
//
//   Request (parsed JSON of a text/plain POST; `action` is ignored here, handle-post routes on it):
//     { name: string, number: string, idempotencyKey: string,
//       items: { id: string, quantity: number }[],          // quantity: whole units wanted of that item
//       website?: string }                                  // the honeypot field; see "Honeypot" below for what trips it
//
//   Success: { ok: true, token, bookingId, units, skipped, whatsappUrl }   // exactly these keys
//     units:   { claimId: number, itemId: string, name: string, outcome: "holder" | "waiting", position: number | null }[]
//              one per unit (a quantity of 3 gives 3 entries, each with its own claimId), in request order.
//              position is the 1-based place among waiters for that item (null for a holder).
//     skipped: { id: string, name: string | null, reason: "sold-out" | "unavailable" }[]  in request order.
//              name is the item's name when the id is known (also for a hidden tab); null for an unknown id.
//              "sold-out": recalculate().soldOut. "unavailable": recalculate().unavailable (quantity 0 or invalid, D-026),
//              an item on a tab that is not published (hidden), or an id that matches no item.
//     whatsappUrl: "https://wa.me/<seller digits>?text=<encoded message>" or null when SELLER_WHATSAPP is not a valid
//              number (the booking is still saved: save first, D-008). The seller's number appears ONLY inside it (D-011).
//     token:   random, >= 128 bits (the handler asks deps.randomBytes for >= 16 bytes), URL-safe characters only.
//   Failure: { ok: false, error: <code>, skipped?: ... } and NOTHING is written. Codes:
//     "invalid-name"      name trimmed is not 2 to 60 characters, or not a string
//     "invalid-number"    normalisePhone() rejects it (src/domain/phone.ts)
//     "invalid-basket"    items missing, empty, a quantity that is not a whole number >= 1, or total units outside 1 to 15
//                         (total counts every unit requested, skipped ones included)
//     "invalid-request"   idempotencyKey missing or not matching ^[A-Za-z0-9-]{16,64}$ (QA F4); request not an object;
//                         or the key is already booked under a DIFFERENT normalised number (nothing written, the
//                         original token never returned)
//     "not-configured"    siteUrl is not an absolute https:// URL (QA F3); answered before the lock, nothing written.
//                         The honeypot is still answered first (success-shaped), then this, then the rest.
//     "too-many-claims"   the number already has active claims, plus the units that would be created, above 20
//     "nothing-available" every requested item was skipped (carries `skipped`, creates no booking)
//     "not-reserving"     the spreadsheet has no Claims tab (status mode, D-038.6) or no Bookings tab
//     "busy"              deps.lock.waitLock threw (timed out)
//
//   Order of work: honeypot, then validate the request and siteUrl WITHOUT touching the sheet; then lock.waitLock; then ALL
//   sheet reads and writes; then ss.flush() after the last write (QA F2) and cache.remove(CATALOGUE_CACHE_KEY); then
//   lock.releaseLock, also when something throws (flush is before releaseLock, inside the lock). Every response path that
//   took the lock releases it. A releaseLock that throws never changes the result (QA F6): a saved booking still answers ok.
//
//   Sheet writes (columns found by header name, never by position, 4.1):
//     Claims, one row per unit: Claim ID = (max numeric Claim ID in the tab, any state) + 1, ascending; Booking ID; Item ID;
//       Item (display name: Books use the book name); Name; Number (E.164); State "active"; Created = now().
//       Promoted at is NOT stamped on a new claim (a new holder saw "Reserved" on the confirmation, D-026.1).
//     Bookings, one row per booking: Booking ID; Token; Name; Number; Created = now(); Idempotency key.
//     The Bookings row is written first (appendRow), then ALL the Claims rows in ONE tab.appendRows call (QA F1a), so a
//     failed claims write leaves a booking with zero claims, never some.
//     Token and Idempotency key are ALWAYS written with a leading apostrophe (QA F9), so Sheets never re-types an
//     all-digit token as a number. Readers strip ONE leading apostrophe when comparing, and answer the token without it.
//     Every user-controlled string goes through guardText (6.3): a value starting = + - or @ gets a leading apostrophe.
//     That includes the E.164 Number (it starts with "+"), so the stored cell reads "'+91...". Readers (the 20-claim
//     count, the idempotency lookup) must therefore compare after removing one leading apostrophe.
//   Queue (D-026.2): recalculate() the item's claims as they are BEFORE the write, pass each resulting role as that claim's
//     previousRole, then recalculate with the new claims (previousRole null) and write Promoted at back for every claim
//     of the touched items from the result (kept for holders, stamped now() for promotions, cleared for non-holders).
//   Idempotency: if a Bookings row already holds the same Idempotency key AND the same normalised Number, return that
//     booking (same token, bookingId, claim ids, whatsappUrl) and write nothing, before the limits are applied. `skipped`
//     is not stored, so on a replay it is [] (smaller reading). Ended (released) claims are left out of a replay's units.
//     Same key but a different number: invalid-request (QA F4).
//     Completing a partial write (QA F1b): if the booking for the key exists but NO Claims row, in any state, has its
//     Booking ID, the request finishes the reservation under the ORIGINAL booking id and token (the request's items, the
//     normal skip / capacity / 20-claim rules, under the lock) instead of answering an empty success. The Bookings row is
//     not rewritten. (A booking that has any claim, even a released one, is a plain replay.)
//   Honeypot: a `website` that is a non-empty string, `true` or a non-zero number returns a success-shaped response (same
//     keys, ok true, a fake token that resolves to nothing, empty units and skipped) and saves nothing, takes no lock, clears
//     no cache, and does not contain the seller number. `0`, `false`, null, "" and an absent field are NOT the trap (QA F8:
//     autofill or a hand-built client must not silently lose a real booking). Other types (objects, arrays) are not pinned.
//   Message (2.8, built by the handler or src/domain/message.ts; asserted here through the URL only):
//     "Hi! I'm <name>." / blank / "Reserved for me:" + "• ..." lines / blank / "On the waiting list:" + "• ..." lines / blank /
//     "Change or back out: <siteUrl>/#/b/<token>". A section with no lines is left out entirely. The name goes in raw
//     (no apostrophe guard: that is a spreadsheet device only). Brand follows the item name on a bullet (S-13 seller
//     note; punctuation is free), Books show book name then author. A waiting bullet ends "(<ordinal> in line)".
//
// NOT covered here, on purpose:
//   - T-18, 10 parallel requests against live staging (1 holder, 9 waiting, no lost or duplicate rows): a live check
//     needing G0.3, not CI. Serial equivalents (order, unique ids, no duplicates) are below.
//   - The 2,000 character WhatsApp limit and "...and N more" (6.3, T-13): S-13 owns it.
//   - The doPost adapter wiring (LockService, CacheService, Script Properties), and the adapter's flush() and appendRows()
//     (SpreadsheetApp.flush(), one setValues): thin, live-checked (T-18 after the flush fix).
//
// Ambiguities and the smaller reading taken: see the report that came with these tests. Synthetic data only.
import { describe, expect, it } from "vitest";
import { catalogue } from "../../src/api/catalogue";
import { CATALOGUE_CACHE_KEY, handleGet } from "../../src/api/handle-get";
import { reserve } from "../../src/api/reserve";
import type { CellValue } from "../../src/api/sheet";
import { counterRandom, FakeSpreadsheet, type FakeTab } from "../fixtures/fake-sheet";

// ---- Fixture

const SELLER = "+91 90000 00099";
const SELLER_DIGITS = "919000000099";
const SITE = "https://example.invalid/medley-sale";
const NOW = "2026-11-06T10:00:00.000Z";
const BUYER = "90000 00011"; // normalises to +919000000011
const BUYER_E164 = "+919000000011";
const OTHER_E164 = "+919000000021";

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
const item = (id: string, name: string, brand: string, price: number | null, quantity: number): Record<string, CellValue> => ({
  Item: name, Brand: brand, Price: price, Status: "Available", "Available from": "Now", ID: id, Quantity: quantity,
});

interface SeedClaim {
  claimId: number; itemId: string; state?: "active" | "released" | "sold"; number?: string; promotedAt?: string | null; bookingId?: string;
}
/** Appends a claim the way the handler would store it (guarded number). */
function seed(ss: FakeSpreadsheet, c: SeedClaim): void {
  const claims = ss.getTab("Claims") as FakeTab;
  claims.appendRow([
    c.claimId, c.bookingId ?? "BK-SEED", c.itemId, "seed item", "Seed Person", `'${c.number ?? OTHER_E164}`,
    c.state ?? "active", "2026-11-01T10:00:00.000Z", c.promotedAt ?? null, null, null, null, null, null,
  ]);
}

interface SeedBooking { id: number; token: string; key: string; number?: string; name?: string }
/** Appends a Bookings row exactly as given (so a test chooses whether the apostrophes are there). */
function seedBooking(ss: FakeSpreadsheet, b: SeedBooking): void {
  (ss.getTab("Bookings") as FakeTab).appendRow([b.id, b.token, b.name ?? "Asha Testperson", b.number ?? `'${BUYER_E164}`, "2026-11-01T10:00:00.000Z", b.key, null]);
}

/** Echo Dot (1), Picture frame (3), Yoga mat (2), Lamp (0), Kettle (1, already sold), Book (1), plus a hidden Archive tab. */
function build(): FakeSpreadsheet {
  const ss = new FakeSpreadsheet("Synthetic sale");
  addTab(ss, "Tech", ITEM_HEADERS, [
    item("I-0001", "Echo Dot", "Zorbo", 2500, 1),
    item("I-0002", "Picture frame", "Framex", 200, 3),
    item("I-0003", "Yoga mat", "Kimjaly", 1000, 2),
    item("I-0004", "Lamp", "Glowco", 300, 0),
    item("I-0007", "Kettle", "Boilco", 400, 1),
  ]);
  addTab(ss, "Books", BOOKS_HEADERS, [
    { Author: "Author Q", "Brand (+ Link)": "Tiny Atlas", Status: "Available", Price: 90, ID: "I-0006", Quantity: 1 },
  ]);
  addTab(ss, "Archive", ITEM_HEADERS, [item("I-0005", "Ghost item", "Spookco", 50, 1)]);
  ss.withTab("Claims", [[...CLAIM_HEADERS]]);
  ss.withTab("Bookings", [[...BOOKING_HEADERS]]);
  seed(ss, { claimId: 1, itemId: "I-0007", state: "sold" }); // the Kettle is sold out
  return ss;
}

type Row = Record<string, CellValue>;
function rowsOf(ss: FakeSpreadsheet, tab: string): Row[] {
  const [head, ...body] = ss.getTab(tab)!.getGrid();
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [String(h), r[i] ?? null])));
}
const claimsOf = (ss: FakeSpreadsheet) => rowsOf(ss, "Claims");
const bookingsOf = (ss: FakeSpreadsheet) => rowsOf(ss, "Bookings");

// ---- Harness

interface Unit { claimId: number; itemId: string; name: string; outcome: "holder" | "waiting"; position: number | null }
interface Skipped { id: string; name: string | null; reason: string }
interface Ok { ok: true; token: string; bookingId: string; units: Unit[]; skipped: Skipped[]; whatsappUrl: string | null }
interface Fail { ok: false; error: string; skipped?: Skipped[] }
type Result = Ok | Fail;

interface Harness {
  ss: FakeSpreadsheet;
  events: string[];
  random: ReturnType<typeof counterRandom>;
  run: (over?: Record<string, unknown>, depsOver?: Record<string, unknown>) => Result;
  ok: (over?: Record<string, unknown>) => Ok;
}

function harness(ss: FakeSpreadsheet = build(), depsOver: Record<string, unknown> = {}): Harness {
  const events: string[] = [];
  // Record every sheet access, so ordering against the lock can be asserted.
  for (const t of ss.tabs) {
    const grid = t.getGrid.bind(t), setCell = t.setCell.bind(t), append = t.appendRow.bind(t);
    t.getGrid = () => { events.push("read"); return grid(); };
    t.setCell = (r, c, v) => { events.push("write"); setCell(r, c, v); };
    t.appendRow = (v) => { events.push("write"); append(v); };
    const appendRows = t.appendRows.bind(t);
    t.appendRows = (rows) => { events.push("write"); appendRows(rows); };
  }
  const flush = ss.flush.bind(ss);
  ss.flush = () => { events.push("flush"); flush(); };
  const random = counterRandom(7);
  const deps = {
    lock: { waitLock: () => { events.push("waitLock"); }, releaseLock: () => { events.push("releaseLock"); } },
    cache: { remove: (k: string) => { events.push(`cache:${k}`); } },
    randomBytes: random.fn,
    now: () => NOW,
    sellerWhatsapp: SELLER,
    siteUrl: SITE,
    ...depsOver,
  };
  let keySeq = 0;
  const request = (over: Record<string, unknown> = {}) => ({
    action: "reserve", name: "Asha Testperson", number: BUYER, idempotencyKey: `idem-key-${String(++keySeq).padStart(10, "0")}`, website: "",
    items: [{ id: "I-0001", quantity: 1 }], ...over,
  });
  const run = (over: Record<string, unknown> = {}, d: Record<string, unknown> = {}): Result =>
    reserve(ss, request(over), { ...deps, ...d } as never) as unknown as Result;
  const ok = (over: Record<string, unknown> = {}): Ok => {
    const r = run(over);
    if (!r.ok) throw new Error(`expected success, got ${JSON.stringify(r)}`);
    return r;
  };
  return { ss, events, random, run, ok };
}

const wa = (r: Ok) => {
  const u = new URL(r.whatsappUrl!);
  return { url: u, text: u.searchParams.get("text") ?? "" };
};
const lines = (r: Ok) => wa(r).text.split("\n");
/** Bullet lines under a header, up to the next blank line. */
function section(r: Ok, header: string): string[] {
  const l = lines(r);
  const at = l.indexOf(header);
  if (at < 0) return [];
  const out: string[] = [];
  for (let i = at + 1; i < l.length && l[i] !== ""; i++) out.push(l[i]!);
  return out;
}

// ---- Behaviours

describe("reserve: saving a booking (rows written)", () => {
  it("returns the unit's outcome and writes one Claims row and one Bookings row", () => {
    const h = harness();
    const r = h.ok();
    expect(r.units).toEqual([{ claimId: 2, itemId: "I-0001", name: "Echo Dot", outcome: "holder", position: null }]);
    expect(r.skipped).toEqual([]);
    const claims = claimsOf(h.ss);
    expect(claims).toHaveLength(2); // the seeded sold Kettle claim plus ours
    expect(claims[1]).toMatchObject({
      "Claim ID": 2, "Booking ID": r.bookingId, "Item ID": "I-0001", Item: "Echo Dot", Name: "Asha Testperson",
      State: "active", Created: NOW,
    });
    expect(bookingsOf(h.ss)).toHaveLength(1);
    expect(bookingsOf(h.ss)[0]).toMatchObject({ "Booking ID": r.bookingId, Token: `'${r.token}`, Name: "Asha Testperson", Created: NOW }); // stored guarded (QA F9)
  });

  it("returns exactly the documented keys on success", () => {
    expect(Object.keys(harness().ok()).sort()).toEqual(["bookingId", "ok", "skipped", "token", "units", "whatsappUrl"]);
  });

  it("stores the number in E.164, guarded with a leading apostrophe because it starts with +", () => {
    const h = harness();
    h.ok();
    expect(claimsOf(h.ss)[1]!.Number).toBe(`'${BUYER_E164}`);
    expect(bookingsOf(h.ss)[0]!.Number).toBe(`'${BUYER_E164}`);
  });

  it("stores the name trimmed", () => {
    const h = harness();
    h.ok({ name: "   Asha Testperson  " });
    expect(claimsOf(h.ss)[1]!.Name).toBe("Asha Testperson");
    expect(bookingsOf(h.ss)[0]!.Name).toBe("Asha Testperson");
  });

  it("finds columns by header name: a Claims tab with its columns in a different order still gets correct cells", () => {
    const ss = build();
    const reordered = [...CLAIM_HEADERS].reverse();
    const claims = ss.getTab("Claims") as FakeTab;
    claims.grid = [reordered, ...claimsOf(ss).map((row) => reordered.map((hd) => row[hd] ?? null))];
    const h = harness(ss);
    const r = h.ok();
    expect(claimsOf(ss)[1]).toMatchObject({ "Claim ID": 2, "Item ID": "I-0001", Name: "Asha Testperson", State: "active", "Booking ID": r.bookingId });
  });

  it("numbers new claims after the highest Claim ID in any state, so ids are never reused", () => {
    const ss = build();
    seed(ss, { claimId: 9, itemId: "I-0002", state: "released" });
    const r = harness(ss).ok({ items: [{ id: "I-0002", quantity: 2 }] });
    expect(r.units.map((u) => u.claimId)).toEqual([10, 11]);
    expect(claimsOf(ss).map((c) => c["Claim ID"])).toEqual([1, 9, 10, 11]);
  });

  it("writes one claim per unit, all under the one Booking ID", () => {
    const h = harness();
    const r = h.ok({ items: [{ id: "I-0002", quantity: 3 }] });
    const mine = claimsOf(h.ss).filter((c) => c["Booking ID"] === r.bookingId);
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((c) => c["Claim ID"])).size).toBe(3);
    expect(bookingsOf(h.ss)).toHaveLength(1);
  });

  it("uses the book name, not a brand, for the Item cell of a Books item", () => {
    const h = harness();
    const r = h.ok({ items: [{ id: "I-0006", quantity: 1 }] });
    expect(r.units[0]).toMatchObject({ name: "Tiny Atlas", itemId: "I-0006" });
    expect(claimsOf(h.ss).at(-1)!.Item).toBe("Tiny Atlas");
  });
});

describe("reserve: per-unit outcome (queue rules 6.1; T-01, T-03, T-09)", () => {
  it("makes the first buyer of a quantity 1 item the holder and the next ones wait in order", () => {
    const h = harness();
    const a = h.ok({ name: "Asha Testperson" });
    const b = h.ok({ name: "Bela Testperson", number: "90000 00012" });
    const c = h.ok({ name: "Chitra Testperson", number: "90000 00013" });
    expect(a.units[0]).toMatchObject({ outcome: "holder", position: null });
    expect(b.units[0]).toMatchObject({ outcome: "waiting", position: 1 });
    expect(c.units[0]).toMatchObject({ outcome: "waiting", position: 2 });
  });

  it("gives 2 holders and 1 waiter when a buyer takes 3 of an item with 2 free, in one booking (T-03)", () => {
    const h = harness();
    const r = h.ok({ items: [{ id: "I-0003", quantity: 3 }] });
    expect(r.units.map((u) => [u.outcome, u.position])).toEqual([["holder", null], ["holder", null], ["waiting", 1]]);
    expect(new Set(claimsOf(h.ss).filter((c) => c["Item ID"] === "I-0003").map((c) => c["Booking ID"])).size).toBe(1);
  });

  it("places a waiter after the waiters already in line, ignoring released claims", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0001" }); // holder
    seed(ss, { claimId: 3, itemId: "I-0001" }); // waiting 1
    seed(ss, { claimId: 4, itemId: "I-0001", state: "released" });
    const r = harness(ss).ok();
    expect(r.units[0]).toMatchObject({ outcome: "waiting", position: 2 });
  });

  it("splits a mixed basket correctly: free, held, just sold and unavailable items (T-09)", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0003" });
    seed(ss, { claimId: 3, itemId: "I-0003" }); // Yoga mat: both units held
    const r = harness(ss).ok({
      items: [
        { id: "I-0001", quantity: 1 }, { id: "I-0003", quantity: 1 }, { id: "I-0007", quantity: 1 },
        { id: "I-0004", quantity: 1 }, { id: "I-0002", quantity: 2 },
      ],
    });
    expect(r.units.map((u) => [u.itemId, u.outcome, u.position])).toEqual([
      ["I-0001", "holder", null], ["I-0003", "waiting", 1], ["I-0002", "holder", null], ["I-0002", "holder", null],
    ]);
    expect(r.skipped.map((s) => [s.id, s.name, s.reason])).toEqual([["I-0007", "Kettle", "sold-out"], ["I-0004", "Lamp", "unavailable"]]);
  });

  it("is not affected by another buyer's units of other items", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0002" });
    expect(harness(ss).ok().units[0]!.outcome).toBe("holder");
  });

  it("serial stand-in for T-18: 10 buyers of a quantity 1 item give 1 holder, 9 waiting, unique ids, no duplicate rows", () => {
    const h = harness();
    const results = Array.from({ length: 10 }, (_, i) =>
      h.ok({ name: `Buyer Number${i}`, number: `90000 000${30 + i}`, idempotencyKey: `parallel-key-${i}-0123456789` }));
    expect(results.filter((r) => r.units[0]!.outcome === "holder")).toHaveLength(1);
    expect(results.map((r) => r.units[0]!.position)).toEqual([null, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const ids = claimsOf(h.ss).map((c) => c["Claim ID"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(claimsOf(h.ss)).toHaveLength(11); // 10 plus the seeded sold Kettle
    expect(bookingsOf(h.ss)).toHaveLength(10);
  });
});

describe("reserve: skipped items (6.2, D-026 notes)", () => {
  it("skips a sold-out item and names it", () => {
    const h = harness();
    const r = h.ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0007", quantity: 1 }] });
    expect(r.skipped).toEqual([{ id: "I-0007", name: "Kettle", reason: "sold-out" }]);
    // Only the seeded sold claim exists for the Kettle: nothing new was queued behind it.
    expect(claimsOf(h.ss).filter((c) => c["Item ID"] === "I-0007")).toHaveLength(1);
  });

  it("skips an item with quantity 0 as unavailable, even though the engine would let it queue (D-026)", () => {
    const h = harness();
    const r = h.ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0004", quantity: 2 }] });
    expect(r.skipped).toEqual([{ id: "I-0004", name: "Lamp", reason: "unavailable" }]);
    expect(claimsOf(h.ss).some((c) => c["Item ID"] === "I-0004")).toBe(false);
  });

  it.each([["a quantity that is not a whole number", 1.5], ["a negative quantity", -1], ["text", "two"]])(
    "skips an item whose sheet Quantity is %s",
    (_label, qty) => {
      const ss = build();
      (ss.getTab("Tech") as FakeTab).setCell(3, 11, qty as CellValue); // Echo Dot's Quantity
      const r = harness(ss).ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0002", quantity: 1 }] });
      expect(r.skipped).toEqual([{ id: "I-0001", name: "Echo Dot", reason: "unavailable" }]);
    },
  );

  it("skips an item on an unpublished (hidden) tab and an unknown id", () => {
    const h = harness();
    const r = h.ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0005", quantity: 1 }, { id: "I-9999", quantity: 1 }] });
    expect(r.skipped).toEqual([
      { id: "I-0005", name: "Ghost item", reason: "unavailable" },
      { id: "I-9999", name: null, reason: "unavailable" },
    ]);
    expect(claimsOf(h.ss).some((c) => c["Item ID"] === "I-0005" || c["Item ID"] === "I-9999")).toBe(false);
  });

  it("creates no booking and writes nothing when every item is skipped", () => {
    const h = harness();
    const before = h.ss.snapshot();
    const r = h.run({ items: [{ id: "I-0007", quantity: 1 }, { id: "I-0004", quantity: 1 }] });
    expect(r).toMatchObject({ ok: false, error: "nothing-available" });
    expect((r as Fail).skipped!.map((s) => s.id)).toEqual(["I-0007", "I-0004"]);
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  });

  it("does not put a skipped item in the WhatsApp message", () => {
    const r = harness().ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0007", quantity: 1 }] });
    expect(wa(r).text).not.toContain("Kettle");
  });
});

describe("reserve: the script lock (6.1 rule 6)", () => {
  it("takes the lock before touching the sheet, writes inside it, clears the cache after the last write, then releases", () => {
    const h = harness();
    h.ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0002", quantity: 2 }] });
    const e = h.events;
    expect(e.filter((x) => x === "waitLock")).toHaveLength(1);
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
    expect(e[0]).toBe("waitLock"); // not even a read before the lock: a read outside the lock can be stale
    expect(e.at(-1)).toBe("releaseLock");
    expect(e).toContain("write");
    expect(e.lastIndexOf("write")).toBeLessThan(e.indexOf(`cache:${CATALOGUE_CACHE_KEY}`));
  });

  it("flushes pending writes after the last write and before the lock is released, inside the lock (QA F2)", () => {
    const h = harness();
    h.ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0002", quantity: 2 }] });
    const e = h.events;
    expect(e.filter((x) => x === "flush")).toHaveLength(1);
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("flush")).toBeLessThan(e.indexOf("releaseLock"));
    expect(e.indexOf("flush")).toBeGreaterThan(e.indexOf("waitLock"));
  });

  it("does not flush when it wrote nothing (a replay, a refusal)", () => {
    const h = harness();
    h.ok({ idempotencyKey: "flush-replay-key-0001" });
    h.events.length = 0;
    h.ok({ idempotencyKey: "flush-replay-key-0001" });
    h.run({ items: [{ id: "I-0007", quantity: 1 }] }); // sold out: nothing-available
    expect(h.events).not.toContain("flush");
  });

  it("asks for a positive wait time", () => {
    let asked = 0;
    harness(build(), { lock: { waitLock: (ms: number) => { asked = ms; }, releaseLock: () => {} } }).ok();
    expect(asked).toBeGreaterThan(0);
  });

  it("releases the lock when a sheet write fails part-way", () => {
    const h = harness();
    const bookings = h.ss.getTab("Bookings") as FakeTab;
    bookings.appendRow = () => { throw new Error("quota"); };
    try { h.run(); } catch { /* the handler may throw or answer; either way the lock must be freed */ }
    expect(h.events.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("keeps a successful result when releaseLock throws (QA F6): the booking is saved and still answered ok", () => {
    const h = harness(build(), { lock: { waitLock: () => {}, releaseLock: () => { throw new Error("lock lost"); } } });
    let r: Result | undefined;
    expect(() => { r = h.run(); }).not.toThrow();
    expect(r).toMatchObject({ ok: true });
    expect(bookingsOf(h.ss)).toHaveLength(1);
    expect(claimsOf(h.ss)).toHaveLength(2);
  });

  it("keeps a refusal as it was when releaseLock throws (not turned into an exception)", () => {
    const h = harness(build(), { lock: { waitLock: () => {}, releaseLock: () => { throw new Error("lock lost"); } } });
    let r: Result | undefined;
    expect(() => { r = h.run({ items: [{ id: "I-0007", quantity: 1 }] }); }).not.toThrow();
    expect(r).toMatchObject({ ok: false, error: "nothing-available" });
  });

  it("answers busy and writes nothing when the lock cannot be taken", () => {
    const h = harness(build(), { lock: { waitLock: () => { throw new Error("timeout"); }, releaseLock: () => {} } });
    const before = h.ss.snapshot();
    expect(h.run()).toMatchObject({ ok: false, error: "busy" });
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  });

  it("does not take the lock for a request that fails validation", () => {
    const h = harness();
    expect(h.run({ name: "A" })).toMatchObject({ ok: false });
    expect(h.events).toEqual([]);
  });
});

describe("reserve: catalogue cache (4.3)", () => {
  it("removes the catalogue cache key after a booking is saved", () => {
    const h = harness();
    h.ok();
    expect(h.events).toContain(`cache:${CATALOGUE_CACHE_KEY}`);
  });

  it("makes the next catalogue read fresh: a cached GET no longer shows the old free unit", () => {
    const ss = build();
    const store = new Map<string, string>();
    const cache = {
      get: (k: string) => store.get(k) ?? null,
      put: (k: string, v: string) => { store.set(k, v); },
      remove: (k: string) => { store.delete(k); },
    };
    const get = () => JSON.parse(handleGet({ action: "catalogue" }, { catalogue: () => catalogue(ss), cache })) as {
      items: { id: string; freeUnits: number; waitingCount: number }[];
    };
    expect(get().items.find((i) => i.id === "I-0001")!.freeUnits).toBe(1); // primes the cache
    const h = harness(ss, { cache });
    h.ok();
    const after = get().items.find((i) => i.id === "I-0001")!;
    expect(after.freeUnits).toBe(0);
    h.ok({ number: "90000 00012" });
    expect(get().items.find((i) => i.id === "I-0001")!.waitingCount).toBe(1);
  });
});

describe("reserve: idempotency (T-08, T-15)", () => {
  it("returns the original booking for a repeated key and writes nothing new", () => {
    const h = harness();
    const first = h.ok({ idempotencyKey: "form-0001-abcdefghij" });
    const before = h.ss.snapshot();
    h.events.length = 0;
    const again = h.ok({ idempotencyKey: "form-0001-abcdefghij" });
    expect(again).toEqual(first);
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  });

  it("does not spend randomness on a replay", () => {
    const h = harness();
    h.ok({ idempotencyKey: "form-0002-abcdefghij" });
    const calls = h.random.requested.length;
    h.ok({ idempotencyKey: "form-0002-abcdefghij" });
    expect(h.random.requested.length).toBe(calls);
  });

  it("treats a different key as a new booking", () => {
    const h = harness();
    const a = h.ok({ idempotencyKey: "form-0003-abcdefghij" });
    const b = h.ok({ idempotencyKey: "form-0004-abcdefghij" });
    expect(b.bookingId).not.toBe(a.bookingId);
    expect(b.token).not.toBe(a.token);
    expect(b.units[0]!.outcome).toBe("waiting");
  });

  it("still returns the original after the item has since sold out", () => {
    const h = harness();
    const first = h.ok({ idempotencyKey: "form-0005-abcdefghij" });
    (h.ss.getTab("Claims") as FakeTab).setCell(3, 7, "sold"); // the seller marks our claim sold
    expect(h.ok({ idempotencyKey: "form-0005-abcdefghij" }).token).toBe(first.token);
  });

  it("returns the original even when the number is now at its 20-claim limit", () => {
    const h = harness();
    const first = h.ok({ idempotencyKey: "form-0006-abcdefghij", items: [{ id: "I-0002", quantity: 15 }] });
    h.ok({ idempotencyKey: "form-0007-abcdefghij", items: [{ id: "I-0002", quantity: 5 }] }); // now exactly 20
    expect(h.ok({ idempotencyKey: "form-0006-abcdefghij", items: [{ id: "I-0002", quantity: 15 }] }).bookingId).toBe(first.bookingId);
  });

  it("finds the stored key whether the sheet kept the leading apostrophe or (as real Sheets reads it) dropped it", () => {
    for (const stored of ["'replay-key-0000001", "replay-key-0000001"]) {
      const ss = build();
      seedBooking(ss, { id: 1, token: "tok-seeded-0001", key: stored, number: `'${BUYER_E164}` });
      seed(ss, { claimId: 2, itemId: "I-0001", bookingId: "1", number: BUYER_E164 });
      const h = harness(ss);
      const r = h.ok({ idempotencyKey: "replay-key-0000001" });
      expect(r.bookingId).toBe(1);
      expect(bookingsOf(ss), stored).toHaveLength(1);
      expect(claimsOf(ss), stored).toHaveLength(2);
    }
  });

  it("keeps the same claim ids and WhatsApp URL on the replay", () => {
    const h = harness();
    const first = h.ok({ idempotencyKey: "form-0008-abcdefghij", items: [{ id: "I-0003", quantity: 3 }] });
    const again = h.ok({ idempotencyKey: "form-0008-abcdefghij", items: [{ id: "I-0003", quantity: 3 }] });
    expect(again.units.map((u) => u.claimId)).toEqual(first.units.map((u) => u.claimId));
    expect(again.whatsappUrl).toBe(first.whatsappUrl);
  });
});

describe("reserve: spreadsheet safety (6.3, T-10)", () => {
  it.each([
    ['=IMPORTXML("https://example.invalid","//a")'], ["+1+1"], ["-2+3"], ["@SUM(1,1)"], ["  =SUM(1,1)  "],
  ])("stores the name %j as plain text with a leading apostrophe", (name) => {
    const h = harness();
    h.ok({ name });
    const stored = name.trim();
    expect(claimsOf(h.ss)[1]!.Name).toBe(`'${stored}`);
    expect(bookingsOf(h.ss)[0]!.Name).toBe(`'${stored}`);
  });

  it("never writes a string starting with = + - or @ into any cell, and never as a formula", () => {
    const h = harness();
    for (const t of h.ss.tabs) (t as FakeTab).writtenStrings = [];
    h.ok({ name: "=HYPERLINK(1,2)" });
    for (const t of h.ss.tabs) {
      for (const s of (t as FakeTab).writtenStrings) expect(s, t.name).not.toMatch(/^[=+\-@]/);
      expect(t.getFormulas(), t.name).toEqual([]);
    }
  });

  it("keeps an ordinary name untouched, including an apostrophe or script text inside it", () => {
    const h = harness();
    h.ok({ name: "O'Neil <script>x</script>" });
    expect(claimsOf(h.ss)[1]!.Name).toBe("O'Neil <script>x</script>");
  });

  it("puts a formula-like name into the message as the person typed it, without the apostrophe", () => {
    const r = harness().ok({ name: "=SUM(1,1)" });
    expect(lines(r)[0]).toBe("Hi! I'm =SUM(1,1).");
  });
});

describe("reserve: honeypot (6.3)", () => {
  it("answers success-shaped, saves nothing, takes no lock and clears no cache", () => {
    const h = harness();
    const real = harness().ok();
    const before = h.ss.snapshot();
    const r = h.run({ website: "https://spam.invalid" }) as Ok;
    expect(r.ok).toBe(true);
    expect(Object.keys(r).sort()).toEqual(Object.keys(real).sort());
    expect(typeof r.token).toBe("string");
    expect(Array.isArray(r.units)).toBe(true);
    expect(Array.isArray(r.skipped)).toBe(true);
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).toEqual([]);
  });

  it("gives the bot a token that finds nothing, and no seller number", () => {
    const h = harness();
    const r = h.run({ website: "x" }) as Ok;
    expect(bookingsOf(h.ss).map((b) => b.Token)).not.toContain(r.token);
    expect(JSON.stringify(r)).not.toContain(SELLER_DIGITS);
  });

  it("is tripped by any non-empty value, but an empty or absent field is a normal request", () => {
    const h = harness();
    h.run({ website: "0" }); // the STRING "0" is non-empty text, so it trips
    expect(claimsOf(h.ss)).toHaveLength(1);
    h.ok({ website: "" });
    const noField = harness();
    noField.ok({ website: undefined });
    expect(claimsOf(noField.ss)).toHaveLength(2);
  });

  // Chosen reading (QA F8, smaller): only a non-empty string, true or a non-zero number is "filled in".
  it.each([["the number 1", 1], ["true", true], ["the number 7", 7], ["a negative number", -1], ["a space", " "]])(
    "is tripped by %s", (_label, website) => {
      const h = harness();
      const before = h.ss.snapshot();
      const r = h.run({ website }) as Ok;
      expect(r.ok).toBe(true);
      expect(r.bookingId).toBe(0);
      expect(h.ss.snapshot()).toBe(before);
      expect(h.events).toEqual([]);
    });

  it.each([["the number 0", 0], ["false", false], ["null", null], ["an empty string", ""], ["absent", undefined]])(
    "is NOT tripped by %s: the booking is really saved", (_label, website) => {
      const h = harness();
      const r = h.ok({ website });
      expect(r.bookingId).not.toBe(0);
      expect(bookingsOf(h.ss)).toHaveLength(1);
      expect(claimsOf(h.ss)).toHaveLength(2);
    });

  it("answers the honeypot before checking SITE_URL (honeypot first, F3)", () => {
    const h = harness(build(), { siteUrl: "" });
    expect(h.run({ website: "x" })).toMatchObject({ ok: true, bookingId: 0 });
  });
});

describe("reserve: validation and limits (6.3)", () => {
  const untouched = (over: Record<string, unknown>, error: string) => {
    const h = harness();
    const before = h.ss.snapshot();
    expect(h.run(over)).toMatchObject({ ok: false, error });
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  };

  it.each([
    ["one character", "A"], ["only spaces", "      "], ["empty", ""], ["61 characters", "a".repeat(61)],
    ["one character plus padding", "  A  "], ["a number", 42],
  ])("rejects a name that is %s", (_label, name) => untouched({ name }, "invalid-name"));

  it("accepts names of exactly 2 and 60 characters, and counts after trimming", () => {
    expect(harness().run({ name: "Al" }).ok).toBe(true);
    expect(harness().run({ name: "a".repeat(60) }).ok).toBe(true);
    expect(harness().run({ name: ` ${"a".repeat(60)} ` }).ok).toBe(true);
  });

  it.each([["letters", "call me"], ["too short", "12345"], ["a national 0 form", ("0900" + "0000011")],
    ["ten digits starting with 0 (QA F7)", ("09000" + "00011")], ["+91 then a trunk 0 (QA F7)", ("+91 0" + "9000 00099")], ["empty", ""], ["a number type", 9000000011]])(
    "rejects a phone number that is %s", (_label, number) => untouched({ number }, "invalid-number"));

  it("normalises the number before storing: '+91 90000 00011' and '9000000011' are the same person", () => {
    const h = harness();
    h.ok({ number: "+91 90000 00011" });
    h.ok({ number: "9000000011" });
    expect(claimsOf(h.ss).map((c) => c.Number).slice(1)).toEqual([`'${BUYER_E164}`, `'${BUYER_E164}`]);
  });

  it.each([
    ["no items", []], ["items missing", undefined], ["not an array", "I-0001"], ["quantity 0", [{ id: "I-0001", quantity: 0 }]],
    ["a negative quantity", [{ id: "I-0001", quantity: -1 }]], ["a fractional quantity", [{ id: "I-0001", quantity: 1.5 }]],
    ["a text quantity", [{ id: "I-0001", quantity: "1" }]], ["16 units in one line", [{ id: "I-0002", quantity: 16 }]],
    ["16 units across two lines", [{ id: "I-0002", quantity: 8 }, { id: "I-0003", quantity: 8 }]],
    ["16 units counting a skippable one", [{ id: "I-0002", quantity: 15 }, { id: "I-0007", quantity: 1 }]],
  ])("rejects a basket with %s", (_label, items) => untouched({ items }, "invalid-basket"));

  it("accepts exactly 15 units", () => {
    const r = harness().ok({ items: [{ id: "I-0002", quantity: 15 }] });
    expect(r.units).toHaveLength(15);
  });

  it.each([["missing", undefined], ["empty", ""], ["a number", 7]])("rejects an idempotency key that is %s", (_label, key) =>
    untouched({ idempotencyKey: key }, "invalid-request"));

  // QA F4: keys must match ^[A-Za-z0-9-]{16,64}$, which also keeps formulas and odd text out of the sheet.
  it.each([
    ["15 characters (one short)", "a".repeat(15)],
    ["65 characters (one long)", "a".repeat(65)],
    ["the old short key '1'", "1"],
    ["a formula", "=HYPERLINK-formula-key"],
    ["a leading plus", "+key-0123456789abcdef"],
    ["a leading minus formula", "-2+3-key-0123456789"],
    ["a leading at sign", "@SUM-key-0123456789ab"],
    ["a space inside", "abcdefgh ijklmnopqr"],
    ["an underscore", "abcdefgh_ijklmnopqr"],
    ["a trailing newline", "abcdefghijklmnop\n"],
    ["a leading tab", "\tabcdefghijklmnop"],
    ["a non-ASCII letter", "abcdefghijklmnopé"],
  ])("rejects an idempotency key with %s", (_label, key) => untouched({ idempotencyKey: key }, "invalid-request"));

  it.each([
    ["exactly 16 characters", "a".repeat(16)],
    ["exactly 64 characters", "B".repeat(64)],
    ["a UUID", "123e4567-e89b-12d3-a456-426614174000"],
    ["digits only", "1234567890123456"],
  ])("accepts an idempotency key that is %s", (_label, key) => {
    expect(harness().run({ idempotencyKey: key }).ok).toBe(true);
  });

  it("refuses a request that is not an object", () => {
    const h = harness();
    for (const bad of [null, undefined, "reserve", 5, []]) {
      expect(reserve(h.ss, bad, { lock: { waitLock() {}, releaseLock() {} }, cache: { remove() {} }, randomBytes: h.random.fn, now: () => NOW, siteUrl: SITE } as never))
        .toMatchObject({ ok: false });
    }
    expect(claimsOf(h.ss)).toHaveLength(1);
  });

  it("allows a number up to 20 active claims and refuses the unit that would make 21", () => {
    const ss = build();
    for (let i = 0; i < 19; i++) seed(ss, { claimId: 100 + i, itemId: "I-0002", number: BUYER_E164 });
    const h = harness(ss);
    expect(h.ok({ items: [{ id: "I-0002", quantity: 1 }] }).units).toHaveLength(1); // now 20
    const before = ss.snapshot();
    expect(h.run({ items: [{ id: "I-0002", quantity: 1 }] })).toMatchObject({ ok: false, error: "too-many-claims" });
    expect(ss.snapshot()).toBe(before);
  });

  it("refuses a whole basket that would cross 20, rather than saving part of it", () => {
    const ss = build();
    for (let i = 0; i < 19; i++) seed(ss, { claimId: 100 + i, itemId: "I-0002", number: BUYER_E164 });
    const before = ss.snapshot();
    expect(harness(ss).run({ items: [{ id: "I-0002", quantity: 2 }] })).toMatchObject({ ok: false, error: "too-many-claims" });
    expect(ss.snapshot()).toBe(before);
  });

  it("counts only ACTIVE claims: released and sold claims of the number do not count", () => {
    const ss = build();
    for (let i = 0; i < 10; i++) seed(ss, { claimId: 100 + i, itemId: "I-0002", number: BUYER_E164 });
    for (let i = 0; i < 5; i++) seed(ss, { claimId: 200 + i, itemId: "I-0002", number: BUYER_E164, state: "released" });
    for (let i = 0; i < 5; i++) seed(ss, { claimId: 300 + i, itemId: "I-0003", number: BUYER_E164, state: "sold" });
    expect(harness(ss).run({ items: [{ id: "I-0002", quantity: 10 }] }).ok).toBe(true);
  });

  it("counts per number: other people's claims do not count, and a differently typed form of the same number does", () => {
    const ss = build();
    for (let i = 0; i < 20; i++) seed(ss, { claimId: 100 + i, itemId: "I-0002", number: OTHER_E164 });
    expect(harness(ss).run({ items: [{ id: "I-0002", quantity: 1 }] }).ok).toBe(true);
    const h = harness();
    h.ok({ items: [{ id: "I-0002", quantity: 15 }], number: "9000000011" });
    h.ok({ items: [{ id: "I-0002", quantity: 5 }], number: "+91 90000 00011" });
    expect(h.run({ items: [{ id: "I-0002", quantity: 1 }], number: "+919000000011" })).toMatchObject({ error: "too-many-claims" });
  });

  it("counts the units it would create, not the skipped ones", () => {
    const ss = build();
    for (let i = 0; i < 19; i++) seed(ss, { claimId: 100 + i, itemId: "I-0002", number: BUYER_E164 });
    const r = harness(ss).run({ items: [{ id: "I-0002", quantity: 1 }, { id: "I-0007", quantity: 1 }] });
    expect(r.ok).toBe(true);
  });

  it("refuses to reserve when the spreadsheet has no Claims tab (status mode), writing and creating nothing", () => {
    const ss = new FakeSpreadsheet("Synthetic sale");
    addTab(ss, "Tech", ITEM_HEADERS, [item("I-0001", "Echo Dot", "Zorbo", 2500, 1)]);
    const h = harness(ss);
    expect(h.run()).toMatchObject({ ok: false, error: "not-reserving" });
    expect(ss.tabs.map((t) => t.name)).toEqual(["Tech"]);
  });
});

describe("reserve: token (D-005)", () => {
  it("asks for at least 128 bits of randomness", () => {
    const h = harness();
    h.ok();
    expect(Math.max(...h.random.requested)).toBeGreaterThanOrEqual(16);
  });

  it("returns a URL-safe token long enough to hold 128 bits, the same one stored in Bookings", () => {
    const h = harness();
    const r = h.ok();
    // 128 bits is 22 base64url characters or 32 hex digits; anything shorter cannot hold it.
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(bookingsOf(h.ss)[0]!.Token).toBe(`'${r.token}`); // stored with the F9 apostrophe, returned without it
  });

  it("gives every booking a different token", () => {
    const h = harness();
    const tokens = Array.from({ length: 5 }, () => h.ok().token);
    expect(new Set(tokens).size).toBe(5);
  });

  it("is made from the injected randomness, not Math.random", () => {
    const a = harness(build(), { randomBytes: (n: number) => new Uint8Array(n).fill(0xab) }).ok().token;
    const b = harness(build(), { randomBytes: (n: number) => new Uint8Array(n).fill(0xab) }).ok().token;
    const c = harness(build(), { randomBytes: (n: number) => new Uint8Array(n).fill(0xcd) }).ok().token;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("does not use the token as, or inside, the Booking ID", () => {
    const r = harness().ok();
    expect(r.bookingId).not.toContain(r.token);
  });
});

describe("reserve: the WhatsApp URL (D-011, D-036, 2.8)", () => {
  it("goes to the seller's number as digits only, with the message in the text parameter", () => {
    const r = harness().ok();
    expect(r.whatsappUrl!.startsWith(`https://wa.me/${SELLER_DIGITS}?text=`)).toBe(true);
    expect(wa(r).url.searchParams.get("text")).toBeTruthy();
  });

  it("is encoded: no raw spaces, line breaks, rupee sign or bullet in the URL", () => {
    const r = harness().ok();
    expect(r.whatsappUrl).not.toMatch(/[\s₹•×]/);
    expect(r.whatsappUrl).toContain("%0A");
  });

  it("accepts the seller number the way D-036 does (digits with the country code)", () => {
    expect(harness(build(), { sellerWhatsapp: SELLER_DIGITS }).ok().whatsappUrl).toContain(`wa.me/${SELLER_DIGITS}?`);
  });

  it.each([["no country code", "9000000099"], ["a trunk 0 after 91", ("+91 0" + "9000 00099")], ["undefined", undefined], ["empty", ""], ["text", "call the seller"]])(
    "returns whatsappUrl null, still saving the booking, when SELLER_WHATSAPP is %s",
    (_label, sellerWhatsapp) => {
      const h = harness(build(), { sellerWhatsapp });
      const r = h.ok();
      expect(r.whatsappUrl).toBeNull();
      expect(r.units).toHaveLength(1);
      expect(claimsOf(h.ss)).toHaveLength(2);
    },
  );

  it("keeps the seller's number out of everything else: the rest of the response, and every cell written", () => {
    const h = harness();
    const r = h.ok({ items: [{ id: "I-0001", quantity: 1 }, { id: "I-0007", quantity: 1 }] });
    expect(JSON.stringify({ ...r, whatsappUrl: null })).not.toContain("9000000099");
    expect(JSON.stringify([claimsOf(h.ss), bookingsOf(h.ss)])).not.toContain("9000000099");
    expect(wa(r).text).not.toContain("9000000099");
  });

  it("ends the message with the private link: SITE_URL, #/b/, the token (trailing slash on SITE_URL tolerated)", () => {
    const r = harness().ok();
    expect(lines(r).at(-1)).toBe(`Change or back out: ${SITE}/#/b/${r.token}`);
    const slashed = harness(build(), { siteUrl: `${SITE}/` }).ok();
    expect(lines(slashed).at(-1)).toBe(`Change or back out: ${SITE}/#/b/${slashed.token}`);
  });

  it("opens with 'Hi! I'm <name>.' and uses no seller name", () => {
    const r = harness().ok({ name: "  Asha Testperson " });
    expect(lines(r)[0]).toBe("Hi! I'm Asha Testperson.");
    expect(lines(r)[1]).toBe("");
  });

  it("lists reserved units under 'Reserved for me:' and waiters under 'On the waiting list:' (2.8)", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0001" }); // someone else holds the Echo Dot
    const r = harness(ss).ok({ items: [{ id: "I-0003", quantity: 1 }, { id: "I-0001", quantity: 1 }] });
    const reserved = section(r, "Reserved for me:");
    const waiting = section(r, "On the waiting list:");
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toMatch(/^• /);
    expect(reserved[0]).toContain("Yoga mat");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toContain("Echo Dot");
    expect(waiting[0]).toContain("1st in line");
    // Reserved comes before the waiting list, and the link comes last.
    expect(lines(r).indexOf("Reserved for me:")).toBeLessThan(lines(r).indexOf("On the waiting list:"));
  });

  it("names the brand after the item name and shows the price, on a reserved bullet (S-13 seller note, 2.8)", () => {
    const bullet = section(harness().ok({ items: [{ id: "I-0003", quantity: 1 }] }), "Reserved for me:")[0]!;
    expect(bullet.indexOf("Yoga mat")).toBeGreaterThan(-1);
    expect(bullet.indexOf("Kimjaly")).toBeGreaterThan(bullet.indexOf("Yoga mat"));
    expect(bullet).toContain("₹1,000"); // brief 2.8 example formats a thousand as ₹1,000
  });

  it("shows several units of one item once, as '× n' with the price 'each'", () => {
    const reserved = section(harness().ok({ items: [{ id: "I-0002", quantity: 2 }] }), "Reserved for me:");
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toContain("Picture frame");
    expect(reserved[0]).toContain("Framex");
    expect(reserved[0]).toContain("× 2");
    expect(reserved[0]).toContain("₹200");
    expect(reserved[0]).toContain("each");
  });

  it("puts the Books book name first and then the author, with no brand label", () => {
    const bullet = section(harness().ok({ items: [{ id: "I-0006", quantity: 1 }] }), "Reserved for me:")[0]!;
    expect(bullet.indexOf("Tiny Atlas")).toBeGreaterThan(-1);
    expect(bullet.indexOf("Author Q")).toBeGreaterThan(bullet.indexOf("Tiny Atlas"));
    expect(bullet).toContain("₹90");
  });

  it("splits one item across both sections when only some of its units are free (T-03)", () => {
    const r = harness().ok({ items: [{ id: "I-0003", quantity: 3 }] });
    expect(section(r, "Reserved for me:").join("\n")).toContain("× 2");
    expect(section(r, "On the waiting list:").join("\n")).toContain("Yoga mat");
  });

  it("leaves out 'On the waiting list:' when nothing is waiting", () => {
    expect(lines(harness().ok())).not.toContain("On the waiting list:");
  });

  it("leaves out 'Reserved for me:' when everything is waiting", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0001" });
    const l = lines(harness(ss).ok());
    expect(l).not.toContain("Reserved for me:");
    expect(l).toContain("On the waiting list:");
  });

  it.each([[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [21, "21st"]])(
    "calls waiting position %i '%s in line'",
    (position, ordinal) => {
      const ss = build();
      // One holder plus (position - 1) waiters already in line puts the new buyer at `position`.
      for (let i = 0; i < position; i++) seed(ss, { claimId: 2 + i, itemId: "I-0001" });
      const r = harness(ss).ok();
      expect(r.units[0]).toMatchObject({ outcome: "waiting", position });
      expect(section(r, "On the waiting list:")[0]).toContain(`${ordinal} in line`);
    },
  );
});

describe("reserve: Promoted at and previousRole (D-026 notes)", () => {
  it("does not stamp Promoted at on the new holder, nor on existing holders, when a write only adds a claim at the end", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0003" });
    seed(ss, { claimId: 3, itemId: "I-0003" });
    harness(ss).ok({ items: [{ id: "I-0003", quantity: 1 }, { id: "I-0001", quantity: 1 }] });
    expect(claimsOf(ss).map((c) => c["Promoted at"])).toEqual([null, null, null, null, null]);
  });

  it("keeps an existing holder's Promoted at stamp (passing previousRole null for everyone would wipe it)", () => {
    const ss = build();
    const stamp = "2026-11-02T09:00:00.000Z";
    seed(ss, { claimId: 2, itemId: "I-0001", promotedAt: stamp }); // a holder, promoted earlier
    harness(ss).ok(); // a waiter joins the same item
    expect(claimsOf(ss).find((c) => c["Claim ID"] === 2)!["Promoted at"]).toBe(stamp);
  });

  it("clears a stale Promoted at from a claim that is no longer a holder (rule 6.1.3)", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0001" }); // holder
    seed(ss, { claimId: 3, itemId: "I-0001", promotedAt: "2026-11-02T09:00:00.000Z" }); // waiting, yet stamped (quantity was cut)
    harness(ss).ok();
    expect(claimsOf(ss).find((c) => c["Claim ID"] === 3)!["Promoted at"]).toBeNull();
  });

  it("leaves other items' claims and their Promoted at alone", () => {
    const ss = build();
    const stamp = "2026-11-02T09:00:00.000Z";
    seed(ss, { claimId: 2, itemId: "I-0002", promotedAt: stamp });
    harness(ss).ok(); // Echo Dot only
    expect(claimsOf(ss).find((c) => c["Claim ID"] === 2)!["Promoted at"]).toBe(stamp);
  });

  it("does not demote or alter existing claims' State or Booking ID", () => {
    const ss = build();
    seed(ss, { claimId: 2, itemId: "I-0001", bookingId: "BK-OLD" });
    const before = claimsOf(ss).slice(0, 2);
    harness(ss).ok();
    expect(claimsOf(ss).slice(0, 2)).toEqual(before);
  });
});

describe("reserve: two writes in a row see each other (the lock is what makes this true live)", () => {
  it("the second request sees the first one's claim even with the first still unread by any cache", () => {
    const h = harness();
    h.ok({ items: [{ id: "I-0001", quantity: 1 }] });
    const second = h.ok({ items: [{ id: "I-0001", quantity: 1 }], number: "90000 00012" });
    expect(second.units[0]).toMatchObject({ outcome: "waiting", position: 1, claimId: 3 });
  });
});

// ---- QA round for S-11 (docs/qa/qa-log.md, 2026-11-06): findings F1 to F9 and the coverage gaps

describe("reserve: a part-way write is never replayed as success (QA F1)", () => {
  const KEY = "retry-key-0000000001";
  const THREE = [{ id: "I-0002", quantity: 3 }]; // Picture frame: 3 in stock, so 3 holders

  it("writes the Bookings row first, then every claim in ONE batched appendRows call (F1a)", () => {
    const h = harness();
    const order: string[] = [];
    const claims = h.ss.getTab("Claims") as FakeTab;
    const bookings = h.ss.getTab("Bookings") as FakeTab;
    const batches: number[] = [];
    const appendBooking = bookings.appendRow.bind(bookings);
    const appendBatch = claims.appendRows.bind(claims);
    const appendSingle = claims.appendRow.bind(claims);
    bookings.appendRow = (v) => { order.push("booking"); appendBooking(v); };
    claims.appendRows = (rows) => { order.push("claims"); batches.push(rows.length); appendBatch(rows); };
    claims.appendRow = (v) => { order.push("single-claim"); appendSingle(v); };
    h.ok({ items: THREE });
    expect(order).toEqual(["booking", "claims"]); // no per-claim appendRow, no second batch
    expect(batches).toEqual([3]);
    expect(claimsOf(h.ss)).toHaveLength(4); // the seeded Kettle claim plus three
  });

  it("leaves zero claims when the batched claims write fails, and a retry with the same key saves every unit under the same booking and token", () => {
    const h = harness();
    const claims = h.ss.getTab("Claims") as FakeTab;
    const working = claims.appendRows.bind(claims);
    claims.appendRows = () => { throw new Error("Service Spreadsheets failed"); }; // all-or-nothing: nothing written
    try { h.run({ idempotencyKey: KEY, items: THREE }); } catch { /* the failure itself may surface as a throw (handlePost turns it into "unavailable") */ }
    expect(claimsOf(h.ss)).toHaveLength(1); // only the seeded Kettle claim: never a partial set of the three
    expect(bookingsOf(h.ss)).toHaveLength(1);
    const orphanToken = String(bookingsOf(h.ss)[0]!.Token).replace(/^'/, "");

    claims.appendRows = working;
    const retry = h.ok({ idempotencyKey: KEY, items: THREE });
    expect(retry.token).toBe(orphanToken);
    expect(retry.bookingId).toBe(bookingsOf(h.ss)[0]!["Booking ID"]);
    expect(retry.units).toHaveLength(3);
    expect(retry.units.every((u) => u.outcome === "holder")).toBe(true);
    expect(bookingsOf(h.ss)).toHaveLength(1);
    const mine = claimsOf(h.ss).filter((c) => c["Booking ID"] === retry.bookingId);
    expect(mine).toHaveLength(3);
    expect(lines(retry).filter((l) => l.startsWith("• "))).toHaveLength(1); // the message names the item ("× 3")
  });

  describe("a booking with no Claims row in any state (the first claim write failed)", () => {
    const orphan = (): FakeSpreadsheet => {
      const ss = build();
      seedBooking(ss, { id: 1, token: "orphan-bk-0001", key: KEY });
      return ss;
    };

    it("completes the reservation under the ORIGINAL booking id and token instead of an empty success", () => {
      const ss = orphan();
      const h = harness(ss);
      const r = h.ok({ idempotencyKey: KEY, items: THREE });
      expect(r.token).toBe("orphan-bk-0001");
      expect(r.bookingId).toBe(1);
      expect(r.units).toHaveLength(3);
      expect(bookingsOf(ss)).toHaveLength(1); // the Bookings row is not duplicated
      expect(claimsOf(ss).filter((c) => c["Booking ID"] === 1)).toHaveLength(3);
      expect(h.random.requested).toEqual([]); // no new token: it reuses the one already issued
      expect(lines(r).at(-1)).toBe(`Change or back out: ${SITE}/#/b/orphan-bk-0001`);
    });

    it("does it under the lock, flushes before releasing, and clears the catalogue cache", () => {
      const h = harness(orphan());
      h.ok({ idempotencyKey: KEY, items: THREE });
      const e = h.events;
      expect(e[0]).toBe("waitLock");
      expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
      expect(e.indexOf("flush")).toBeLessThan(e.indexOf("releaseLock"));
      expect(e).toContain(`cache:${CATALOGUE_CACHE_KEY}`);
    });

    it("applies the normal queue rules: behind someone who took the unit in the meantime, the unit waits", () => {
      const ss = orphan();
      seed(ss, { claimId: 2, itemId: "I-0001", bookingId: "7", number: OTHER_E164 });
      const r = harness(ss).ok({ idempotencyKey: KEY, items: [{ id: "I-0001", quantity: 1 }] });
      expect(r.units[0]).toMatchObject({ outcome: "waiting", position: 1, claimId: 3 });
    });

    it("applies the skip rules: a sold-out item is skipped and named, the rest is saved", () => {
      const ss = orphan();
      const r = harness(ss).ok({ idempotencyKey: KEY, items: [{ id: "I-0007", quantity: 1 }, { id: "I-0002", quantity: 1 }] });
      expect(r.skipped).toEqual([{ id: "I-0007", name: "Kettle", reason: "sold-out" }]);
      expect(r.units.map((u) => u.itemId)).toEqual(["I-0002"]);
    });

    it("answers nothing-available, writing nothing, when every item has since sold out", () => {
      const ss = orphan();
      const before = ss.snapshot();
      const h = harness(ss);
      expect(h.run({ idempotencyKey: KEY, items: [{ id: "I-0007", quantity: 1 }] })).toMatchObject({ ok: false, error: "nothing-available" });
      expect(ss.snapshot()).toBe(before);
      expect(h.events).not.toContain("write");
    });

    it("applies the 20-claim limit, refusing and writing nothing", () => {
      const ss = orphan();
      for (let i = 0; i < 19; i++) seed(ss, { claimId: 100 + i, itemId: "I-0002", number: BUYER_E164 });
      const before = ss.snapshot();
      const h = harness(ss);
      expect(h.run({ idempotencyKey: KEY, items: [{ id: "I-0002", quantity: 2 }] })).toMatchObject({ ok: false, error: "too-many-claims" });
      expect(ss.snapshot()).toBe(before);
    });

    it("finishes only once: the next retry is a plain replay that writes nothing", () => {
      const ss = orphan();
      const h = harness(ss);
      const first = h.ok({ idempotencyKey: KEY, items: THREE });
      const before = ss.snapshot();
      h.events.length = 0;
      expect(h.ok({ idempotencyKey: KEY, items: THREE })).toEqual(first);
      expect(ss.snapshot()).toBe(before);
      expect(h.events).not.toContain("write");
    });

    it("does not complete it for a different number (F4 wins): invalid-request, nothing written, token not returned", () => {
      const ss = orphan();
      const before = ss.snapshot();
      const r = harness(ss).run({ idempotencyKey: KEY, number: "90000 00021", items: THREE });
      expect(r).toMatchObject({ ok: false, error: "invalid-request" });
      expect(JSON.stringify(r)).not.toContain("orphan-bk-0001");
      expect(ss.snapshot()).toBe(before);
    });
  });

  it("treats a booking whose only claims are released as a plain replay, not as an orphan to complete", () => {
    const ss = build();
    seedBooking(ss, { id: 1, token: "backed-out-bk1", key: KEY });
    seed(ss, { claimId: 2, itemId: "I-0002", bookingId: "1", number: BUYER_E164, state: "released" });
    const before = ss.snapshot();
    const h = harness(ss);
    const r = h.ok({ idempotencyKey: KEY, items: THREE });
    expect(r.token).toBe("backed-out-bk1");
    expect(r.units).toEqual([]);
    expect(ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  });
});

describe("reserve: SITE_URL must be an absolute https URL (QA F3)", () => {
  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["a relative path", "/medley-sale"],
    ["a bare host", "example.invalid/medley-sale"],
    ["http, not https", "http://example.invalid/medley-sale"],
    ["a javascript URL", "javascript:alert(1)"],
  ])("answers not-configured, before the lock and writing nothing, when SITE_URL is %s", (_label, siteUrl) => {
    const h = harness(build(), { siteUrl });
    const before = h.ss.snapshot();
    expect(h.run()).toEqual({ ok: false, error: "not-configured" });
    expect(h.events).toEqual([]); // no lock, no read, no write, no cache
    expect(h.ss.snapshot()).toBe(before);
  });

  it("still works with an absolute https URL, with or without a trailing slash", () => {
    expect(harness(build(), { siteUrl: "https://example.invalid/medley-sale/" }).run().ok).toBe(true);
    expect(harness(build(), { siteUrl: "https://example.invalid" }).run().ok).toBe(true);
  });
});

describe("reserve: a key only replays for the number that made it (QA F4)", () => {
  it("answers invalid-request for the same key with a different number, writing nothing and never returning the token", () => {
    const h = harness();
    const first = h.ok({ idempotencyKey: "shared-key-0000000001" });
    const before = h.ss.snapshot();
    h.events.length = 0;
    const r = h.run({ idempotencyKey: "shared-key-0000000001", number: "90000 00021", name: "Someone Else" });
    expect(r).toEqual({ ok: false, error: "invalid-request" });
    expect(JSON.stringify(r)).not.toContain(first.token);
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  });

  it("still replays when the same number is typed differently", () => {
    const h = harness();
    const first = h.ok({ idempotencyKey: "shared-key-0000000002", number: "9000000011" });
    const again = h.ok({ idempotencyKey: "shared-key-0000000002", number: "+91-90000-00011" });
    expect(again).toEqual(first);
    expect(bookingsOf(h.ss)).toHaveLength(1);
  });

  it("compares against the stored number whether or not the sheet kept its apostrophe", () => {
    for (const stored of [`'${BUYER_E164}`, BUYER_E164]) {
      const ss = build();
      seedBooking(ss, { id: 1, token: "tok-seeded-0002", key: "shared-key-0000000003", number: stored });
      seed(ss, { claimId: 2, itemId: "I-0001", bookingId: "1", number: BUYER_E164 });
      const h = harness(ss);
      expect(h.ok({ idempotencyKey: "shared-key-0000000003" }).token, stored).toBe("tok-seeded-0002");
      expect(h.run({ idempotencyKey: "shared-key-0000000003", number: "90000 00021" }), stored).toMatchObject({ ok: false, error: "invalid-request" });
    }
  });
});

describe("reserve: Token and Idempotency key are written text-guarded (QA F9)", () => {
  it("writes both with a leading apostrophe, and returns the token without it", () => {
    const h = harness();
    const r = h.ok({ idempotencyKey: "guard-key-00000000001" });
    expect(r.token).not.toMatch(/^'/);
    expect(bookingsOf(h.ss)[0]!.Token).toBe(`'${r.token}`);
    expect(bookingsOf(h.ss)[0]!["Idempotency key"]).toBe("'guard-key-00000000001");
  });

  it("keeps an all-digit token safe: stored guarded, answered bare, and a retry still matches and returns it", () => {
    // Bytes 0x12 give the hex token "1212...": digits only, which Sheets would re-type as a number if unguarded.
    const h = harness(build(), { randomBytes: (n: number) => new Uint8Array(n).fill(0x12) });
    const r = h.ok({ idempotencyKey: "digits-key-0000000001" });
    expect(r.token).toMatch(/^\d{32,}$/);
    expect(bookingsOf(h.ss)[0]!.Token).toBe(`'${r.token}`);
    const again = h.ok({ idempotencyKey: "digits-key-0000000001" });
    expect(again.token).toBe(r.token);
    expect(lines(again).at(-1)).toBe(`Change or back out: ${SITE}/#/b/${r.token}`);
  });

  it("strips one leading apostrophe from a stored token when replaying, and leaves a bare one alone", () => {
    for (const [stored, expected] of [["'tok-guarded-0001", "tok-guarded-0001"], ["tok-bare-0000001", "tok-bare-0000001"]] as const) {
      const ss = build();
      seedBooking(ss, { id: 1, token: stored, key: "'strip-key-000000000001" });
      seed(ss, { claimId: 2, itemId: "I-0001", bookingId: "1", number: BUYER_E164 });
      expect(harness(ss).ok({ idempotencyKey: "strip-key-000000000001" }).token).toBe(expected);
    }
  });
});

describe("reserve: coverage gaps found by QA's mutation check", () => {
  it.each([
    ["a line feed", "Asha\nReserved for me:"],
    ["a CR LF pair", "Asha\r\nReserved for me:"],
    ["a lone CR", "Asha\rReserved for me:"],
  ])("flattens %s in the buyer's name to a single space in the message, but keeps the trimmed name in the sheet", (_label, name) => {
    const h = harness();
    const r = h.ok({ name: `  ${name}  ` });
    expect(lines(r)[0]).toBe("Hi! I'm Asha Reserved for me:.");
    expect(lines(r).filter((l) => l === "Reserved for me:")).toHaveLength(1); // only the real header: no forged line
    expect(claimsOf(h.ss)[1]!.Name).toBe(name);
    expect(bookingsOf(h.ss)[0]!.Name).toBe(name);
  });

  it("leaves a backed-out (released) claim out of a replay's units", () => {
    const h = harness();
    const first = h.ok({ idempotencyKey: "ended-key-00000000001", items: [{ id: "I-0002", quantity: 2 }] });
    expect(first.units).toHaveLength(2);
    (h.ss.getTab("Claims") as FakeTab).setCell(3, 7, "released"); // row 3 = our first claim; col 7 = State
    const again = h.ok({ idempotencyKey: "ended-key-00000000001", items: [{ id: "I-0002", quantity: 2 }] });
    expect(again.units.map((u) => u.claimId)).toEqual([first.units[1]!.claimId]);
    expect(lines(again).filter((l) => l.startsWith("• "))).toHaveLength(1);
  });

  it("takes new claim ids from the whole Claim ID column, so a row that would be skipped as invalid still keeps its id", () => {
    const ss = build();
    const claims = ss.getTab("Claims") as FakeTab;
    const raw = (id: number, itemId: string | null, state: string | null) =>
      claims.appendRow(CLAIM_HEADERS.map((h) => (h === "Claim ID" ? id : h === "Item ID" ? itemId : h === "State" ? state : null)));
    raw(50, "I-0002", "bogus-state"); // unknown State
    raw(60, null, "active"); // no Item ID
    raw(40, "I-0002", null); // no State at all
    const r = harness(ss).ok({ items: [{ id: "I-0002", quantity: 2 }] });
    expect(r.units.map((u) => u.claimId)).toEqual([61, 62]);
  });

  it("guards the Claims Item cell like any user text, but shows the real item name everywhere else", () => {
    const ss = build();
    (ss.getTab("Tech") as FakeTab).grid.push(ITEM_HEADERS.map((hd) => item("I-0009", "-Retro lamp", "Glowco", 300, 1)[hd] ?? null));
    const h = harness(ss);
    const r = h.ok({ items: [{ id: "I-0009", quantity: 1 }] });
    expect(claimsOf(ss).at(-1)!.Item).toBe("'-Retro lamp");
    expect(r.units[0]!.name).toBe("-Retro lamp");
    expect(section(r, "Reserved for me:")[0]).toContain("-Retro lamp");
    expect(section(r, "Reserved for me:")[0]).not.toContain("'-Retro lamp");
  });
});

// ---- Carried bugfixes from the S-11 QA re-check (S-15 story file, "Bugfix tickets carried from S-11")

describe("reserve: R1 a booking is orphaned only when NO raw Claims row carries its Booking ID, whatever the State", () => {
  const KEY = "r1-retry-key-0000001";
  const THREE = [{ id: "I-0002", quantity: 3 }];
  const STATE_COL = 6; // 0-based index of "State" in CLAIM_HEADERS

  // The seller typed over the dropdown, or a paste put a stray space in: the row exists, but its State is not valid.
  it.each([["Sold "], ["SOLD"], ["bogus"], [""], [null]])(
    "replays the booking (same token, no new claims, no writes) when all 3 of its claims have the State %j",
    (state) => {
      const h = harness();
      const first = h.ok({ idempotencyKey: KEY, items: THREE });
      const claims = h.ss.getTab("Claims") as FakeTab;
      for (const row of [3, 4, 5]) claims.grid[row - 1]![STATE_COL] = state; // row 1 header, row 2 the seeded Kettle claim
      h.events.length = 0;
      const again = h.ok({ idempotencyKey: KEY, items: THREE });
      expect(again.token).toBe(first.token);
      expect(again.bookingId).toBe(first.bookingId);
      expect(claimsOf(h.ss)).toHaveLength(4); // nothing re-created: re-creating is the double-booking
      expect(bookingsOf(h.ss)).toHaveLength(1);
      expect(h.events).not.toContain("write");
    },
  );

  it("still completes a booking whose claims were never written (no row at all with that Booking ID)", () => {
    const ss = build();
    seedBooking(ss, { id: 1, token: "orphan-bk-0001", key: KEY });
    seed(ss, { claimId: 2, itemId: "I-0001", bookingId: "7", state: "sold" }); // someone else's row must not count as ours
    const r = harness(ss).ok({ idempotencyKey: KEY, items: THREE });
    expect(r.token).toBe("orphan-bk-0001");
    expect(claimsOf(ss).filter((c) => c["Booking ID"] === 1)).toHaveLength(3);
  });
});

describe("reserve: R2 a throwing flush still releases the lock", () => {
  it("releases the lock exactly once, after the flush attempt, and still tries to clear the catalogue cache", () => {
    const h = harness();
    h.ss.flush = () => { h.events.push("flush"); throw new Error("Service Spreadsheets failed"); };
    try { h.run(); } catch { /* the failure may surface as a throw; the lock must be freed either way */ }
    const e = h.events;
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
    expect(e.indexOf("flush")).toBeGreaterThan(-1);
    expect(e.indexOf("flush")).toBeLessThan(e.indexOf("releaseLock"));
    expect(e).toContain(`cache:${CATALOGUE_CACHE_KEY}`);
  });
});

describe("reserve: R3 SITE_URL is trimmed before it is checked", () => {
  it.each([
    ["a trailing space and newline", " https://example.invalid/medley-sale/ \n"],
    ["a leading tab and trailing CR LF", "\thttps://example.invalid/medley-sale\r\n"],
  ])("accepts SITE_URL with %s, and the private link has no stray whitespace", (_label, siteUrl) => {
    const h = harness(build(), { siteUrl });
    const r = h.ok();
    expect(lines(r).at(-1)).toBe(`Change or back out: https://example.invalid/medley-sale/#/b/${r.token}`);
  });

  it("still refuses a SITE_URL that is only whitespace", () => {
    expect(harness(build(), { siteUrl: " \n " }).run()).toEqual({ ok: false, error: "not-configured" });
  });
});

describe("reserve: SITE_URL with userinfo is not configured (a surviving mutant in the QA mutation check)", () => {
  it.each([
    ["a user name", ["https://seller", "example.invalid/medley-sale"].join("@")],
    ["a user name and a password", ["https://seller:pw", "example.invalid/"].join("@")],
    ["an empty user name", "https://@example.invalid/"],
  ])("answers not-configured, before the lock and writing nothing, for %s", (_label, siteUrl) => {
    const h = harness(build(), { siteUrl });
    const before = h.ss.snapshot();
    expect(h.run()).toEqual({ ok: false, error: "not-configured" });
    expect(h.events).toEqual([]);
    expect(h.ss.snapshot()).toBe(before);
  });
});
