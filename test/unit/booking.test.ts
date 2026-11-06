// S-12: the booking API (brief 2.7, 4.3, 6.1 rule 8, 6.4; D-005, D-009, D-011). In-memory fake sheet, synthetic data only.
//
// DESIGNED INTERFACE (the spec for src/api/booking.ts; sync like the rest of src/api; the UI track builds against it):
//
//   booking(ss: Spreadsheet, request: unknown, deps: BookingDeps): BookingResponse
//
//   BookingDeps = {
//     now: () => string;               // ISO; only used to run the queue read-only
//     siteUrl: string;                 // Script Property SITE_URL, for the private link in whatsappUrl (reserve's rule)
//     sellerWhatsapp?: string;         // Script Property SELLER_WHATSAPP (contactUrl rules, D-036)
//   }                                  // no lock, no cache, no randomness: it only reads (see "No lock" below)
//
//   Request: { token: string }  (the parsed body; `action` is ignored here, handlePost routes on it)
//
//   Success: { ok: true, booking: BookingView, whatsappUrl: string | null }   // exactly these keys
//   Failure: { ok: false, error: "not-found" | "not-reserving" }              // exactly these keys
//     "not-found"     the token matches no booking. THE SAME ANSWER, byte for byte, for a missing, non-string, empty,
//                     oddly shaped, over-long or well-formed-but-unknown token, and for a blank Token cell: it never hints
//                     whether the format was valid (T-11). The stored token carries a leading apostrophe (QA F9);
//                     the comparison strips ONE apostrophe from the stored value only. The request's own apostrophe is not
//                     stripped, so "'<token>" does not match. Exact match: no trimming and no case folding.
//     "not-reserving" the spreadsheet has no Claims or no Bookings tab (status mode, D-038.6).
//
//   BookingView = {
//     bookingId: number,
//     name: string,                              // the buyer's own name, as typed (apostrophe guard removed)
//     reserved: Line[],                          // holder claims, one line per item, "× n" = quantity
//     waiting:  WaitingLine[],                   // active non-holder claims, ONE per unit (each has its own place)
//     sold:     Line[],                          // claims the seller marked sold to this buyer, grouped like reserved
//     ended:    Line[],                          // released claims (backed out or released by the seller), grouped
//   }
//   Line        = { itemId, name, detail: string | null, isBook: boolean, quantity: number, claimIds: number[] }
//                 name is the item's display name (a Books row uses the book name), detail its brand or the book's author.
//                 claimIds ascend, each is a valid backOut target; quantity === claimIds.length. Lines are ordered by their
//                 lowest claimId.
//   WaitingLine = { claimId, itemId, name, detail, isBook, position: number, itemSold: boolean }, ordered by claimId.
//                 position: 1-based place among that item's waiters (rule 6.1.2). itemSold: true when the item is sold out
//                 and this claim is still active: the page says "This item was sold" (6.1.8).
//   A group with nothing in it is an empty array, never missing.
//
//   whatsappUrl: the buyer's message to the seller for what they currently hold or wait for: "https://wa.me/<seller digits>?text=
//     <encoded>", built with domain/message.ts buildMessage from the CURRENT reserved and waiting units (sold and ended
//     items are left out), ending with the private link "<SITE_URL>/#/b/<token>". null when there is nothing active,
//     when SELLER_WHATSAPP is not a valid number, or when SITE_URL is unusable (the booking is still shown).
//
//   Never in the answer (D-009, D-011): the buyer's number, other buyers' names, numbers, tokens, claims or booking ids,
//     the sheet's row numbers. The seller's number appears only inside whatsappUrl.
//
//   No lock (smaller reading, justified): booking reads and writes nothing. Every handler that changes the sheet takes the
//   script lock and flushes before releasing, so a reader sees either the state before or after a change, apart from a booking
//   whose claims are being appended, which shows empty groups for a moment. Taking the lock for a read would make a page view
//   able to answer "busy" and delay a reserve. It also writes nothing, flushes nothing and never clears the cache.
import { describe, expect, it } from "vitest";
import { booking } from "../../src/api/booking";
import type { FakeTab } from "../fixtures/fake-sheet";
import { FakeSpreadsheet } from "../fixtures/fake-sheet";
import {
  SELLER_DIGITS, SELLER_PROPERTY, SITE, build, digits, e164, harness, tokenOf, type SeedClaim,
} from "../fixtures/queue-sheet";

const NOW = "2026-11-06T10:00:00.000Z";
const deps = (over: Record<string, unknown> = {}) => ({ now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY, ...over }) as never;
const ask = (ss: FakeSpreadsheet, token: unknown, over: Record<string, unknown> = {}) => booking(ss, { token }, deps(over));
const NOT_FOUND = { ok: false, error: "not-found" };

// Item I-0001 Echo Dot qty 1 (Zorbo); I-0002 Picture frame qty 3 (Framex); I-0003 Yoga mat qty 2; I-0006 Tiny Atlas (book, Author Q) qty 1;
// I-0008 Mystery box qty 1.
const SEED: SeedClaim[] = [
  // Booking 1: holds the Echo Dot and 2 frames, bought 1 yoga mat, backed out of the book.
  { id: 1, item: "I-0001" },
  { id: 2, item: "I-0002", booking: 1 }, { id: 3, item: "I-0002", booking: 1 },
  { id: 4, item: "I-0003", booking: 1, state: "sold", soldPrice: 1000 },
  { id: 5, item: "I-0006", booking: 1, state: "released" },
  // Bookings 2 and 3 wait for the Echo Dot, in that order.
  { id: 6, item: "I-0001", booking: 2 },
  { id: 7, item: "I-0001", booking: 3 },
  // Mystery box: sold to booking 4, booking 5 still waiting on it.
  { id: 8, item: "I-0008", booking: 4, state: "sold" },
  { id: 9, item: "I-0008", booking: 5 },
];
// Claim 1 belongs to booking 1 through the fixture's default (booking = claim id).

describe("booking: the view (S-12 groups: Reserved, Waiting with position, Sold to you, Ended)", () => {
  it("returns one buyer's whole booking in the designed shape, multi-unit items grouped with a quantity", () => {
    const r = ask(build(SEED), tokenOf(1));
    expect(r).toEqual({
      ok: true,
      booking: {
        bookingId: 1,
        name: "Buyer 1",
        reserved: [
          { itemId: "I-0001", name: "Echo Dot", detail: "Zorbo", isBook: false, quantity: 1, claimIds: [1] },
          { itemId: "I-0002", name: "Picture frame", detail: "Framex", isBook: false, quantity: 2, claimIds: [2, 3] }, // "Picture frame × 2"
        ],
        waiting: [],
        sold: [{ itemId: "I-0003", name: "Yoga mat", detail: "Kimjaly", isBook: false, quantity: 1, claimIds: [4] }],
        ended: [{ itemId: "I-0006", name: "Tiny Atlas", detail: "Author Q", isBook: true, quantity: 1, claimIds: [5] }],
      },
      whatsappUrl: expect.stringMatching(/^https:\/\/wa\.me\//),
    });
  });

  it("lists each waiting unit separately with its own place in line", () => {
    const two = ask(build(SEED), tokenOf(2)) as { booking: { waiting: unknown[]; reserved: unknown[] } };
    expect(two.booking.reserved).toEqual([]);
    expect(two.booking.waiting).toEqual([
      { claimId: 6, itemId: "I-0001", name: "Echo Dot", detail: "Zorbo", isBook: false, position: 1, itemSold: false },
    ]);
    const three = ask(build(SEED), tokenOf(3)) as { booking: { waiting: { position: number }[] } };
    expect(three.booking.waiting.map((w) => w.position)).toEqual([2]);
  });

  it("gives a buyer waiting for two units of one item two waiting lines, in Claim ID order", () => {
    // Quantity 1 item: claim 1 holds, claims 2 and 3 (same booking) wait as 1st and 2nd.
    const ss = build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001", booking: 9 }, { id: 3, item: "I-0001", booking: 9 }]);
    const r = ask(ss, tokenOf(9)) as { booking: { waiting: { claimId: number; position: number }[] } };
    expect(r.booking.waiting.map((w) => [w.claimId, w.position])).toEqual([[2, 1], [3, 2]]);
  });

  it("marks a waiter on a sold-out item (rule 6.1.8: 'This item was sold') and keeps the claim active", () => {
    const r = ask(build(SEED), tokenOf(5)) as { booking: { waiting: { claimId: number; itemSold: boolean }[] } };
    expect(r.booking.waiting).toMatchObject([{ claimId: 9, itemId: "I-0008", itemSold: true }]);
  });

  it("shows a buyer's own sold claim under Sold, and nothing is marked sold for a waiter of an item that is not sold out", () => {
    const sold = ask(build(SEED), tokenOf(4)) as { booking: { sold: { claimIds: number[] }[]; waiting: unknown[] } };
    expect(sold.booking.sold.map((l) => l.claimIds)).toEqual([[8]]);
    expect(sold.booking.waiting).toEqual([]);
  });

  it("puts a released claim under Ended whatever its item's state, and does not count it in anyone's line", () => {
    const r = ask(build([{ id: 1, item: "I-0001", state: "released" }, { id: 2, item: "I-0001" }]), tokenOf(1)) as {
      booking: { ended: { claimIds: number[] }[]; reserved: unknown[]; waiting: unknown[] };
    };
    expect(r.booking.ended.map((l) => l.claimIds)).toEqual([[1]]);
    expect(r.booking.reserved).toEqual([]);
    expect(r.booking.waiting).toEqual([]);
  });

  it("follows the queue: a waiter whose holder released becomes Reserved on the next read", () => {
    const ss = build([{ id: 1, item: "I-0001", state: "released" }, { id: 2, item: "I-0001" }]);
    const r = ask(ss, tokenOf(2)) as { booking: { reserved: { claimIds: number[] }[]; waiting: unknown[] } };
    expect(r.booking.reserved.map((l) => l.claimIds)).toEqual([[2]]);
    expect(r.booking.waiting).toEqual([]);
  });

  it("an empty booking (no claims saved) is still a booking with four empty groups", () => {
    const ss = build([]);
    (ss.getTab("Bookings") as FakeTab).appendRow([7, `'${tokenOf(7)}`, "Buyer 7", `'${e164(7)}`, "2026-11-01T10:00:00.000Z", "'key-7", null]);
    expect(ask(ss, tokenOf(7))).toMatchObject({ ok: true, booking: { bookingId: 7, reserved: [], waiting: [], sold: [], ended: [] }, whatsappUrl: null });
  });

  it("returns the buyer's name without the formula guard", () => {
    const ss = build([{ id: 1, item: "I-0001", name: "=Evil()" }]);
    expect(ask(ss, tokenOf(1))).toMatchObject({ booking: { name: "=Evil()" } });
  });

  it("works on Sheets that read strings back without the leading apostrophe", () => {
    const ss = build(SEED);
    for (const t of ss.tabs) (t as FakeTab).dropApostrophes = true;
    expect(ask(ss, tokenOf(1))).toMatchObject({ ok: true, booking: { bookingId: 1 } });
  });

  it("finds claims by Claim ID and columns by header name, not position (a reversed Claims tab gives the same view)", () => {
    const plain = ask(build(SEED), tokenOf(1));
    const ss = build(SEED);
    const t = ss.getTab("Claims") as FakeTab;
    t.grid = t.grid.map((r) => [...r].reverse());
    t.grid = [t.grid[0]!, ...t.grid.slice(1).reverse()];
    expect(ask(ss, tokenOf(1))).toEqual(plain);
  });
});

describe("booking: the WhatsApp URL (4.3)", () => {
  const parse = (r: unknown) => {
    const url = (r as { whatsappUrl: string }).whatsappUrl;
    const u = new URL(url);
    return { u, text: u.searchParams.get("text") ?? "" };
  };

  it("is a wa.me link to the seller whose message names the buyer, what they hold or wait for, and ends with the private link", () => {
    const { u, text } = parse(ask(build(SEED), tokenOf(1)));
    expect(`${u.origin}${u.pathname}`).toBe(`https://wa.me/${SELLER_DIGITS}`);
    expect(text).toContain("Buyer 1");
    expect(text).toContain("Echo Dot");
    expect(text).toContain("Picture frame");
    expect(text.endsWith(`${SITE}/#/b/${tokenOf(1)}`)).toBe(true);
  });

  it("leaves sold and ended items out of the message", () => {
    const { text } = parse(ask(build(SEED), tokenOf(1)));
    expect(text).not.toContain("Yoga mat");
    expect(text).not.toContain("Tiny Atlas");
  });

  it("is null when nothing is active, when the seller number is invalid or missing, and when SITE_URL is unusable, with the booking still shown", () => {
    const allEnded = build([{ id: 1, item: "I-0001", state: "released" }]);
    expect(ask(allEnded, tokenOf(1))).toMatchObject({ ok: true, whatsappUrl: null });
    for (const sellerWhatsapp of ["12", "", "not a number", undefined]) {
      expect(ask(build(SEED), tokenOf(1), { sellerWhatsapp }), String(sellerWhatsapp)).toMatchObject({ ok: true, whatsappUrl: null, booking: { bookingId: 1 } });
    }
    for (const siteUrl of ["", "http://example.invalid", "javascript:alert(1)"]) {
      expect(ask(build(SEED), tokenOf(1), { siteUrl }), siteUrl).toMatchObject({ ok: true, whatsappUrl: null, booking: { bookingId: 1 } });
    }
  });
});

describe("booking: tokens and not-found (T-11, D-005)", () => {
  it("answers an unknown token with exactly { ok: false, error: 'not-found' }", () => {
    expect(ask(build(SEED), "0123456789abcdef0123456789abcdef")).toEqual(NOT_FOUND);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["spaces", "   "],
    ["a number", 1],
    ["a number equal to a booking id", 1.0],
    ["an object", { $ne: "" }],
    ["an array holding a real token", [tokenOf(1)]],
    ["a boolean", true],
    ["a 10,000-character string", "a".repeat(10_000)],
    ["a real token with a leading apostrophe", `'${tokenOf(1)}`],
    ["a real token with a different case", tokenOf(1).toUpperCase()],
    ["a real token plus a character", `${tokenOf(1)}x`],
    ["a real token's prefix", tokenOf(1).slice(0, 6)],
  ])("answers a %s token with the identical not-found answer, so the format of a token is never hinted", (_label, token) => {
    const ss = build(SEED);
    const before = ss.snapshot();
    expect(JSON.stringify(ask(ss, token))).toBe(JSON.stringify(NOT_FOUND));
    expect(ss.snapshot()).toBe(before);
  });

  it("answers a missing request body or a non-object request with the same not-found answer, without throwing", () => {
    for (const request of [undefined, null, "token", 7, []]) {
      expect(booking(build(SEED), request, deps())).toEqual(NOT_FOUND);
    }
  });

  it("an empty token never matches a booking whose Token cell is blank", () => {
    const ss = build(SEED);
    (ss.getTab("Bookings") as FakeTab).appendRow([42, null, "Buyer 42", `'${e164(42)}`, "2026-11-01T10:00:00.000Z", "'key-42", null]);
    (ss.getTab("Claims") as FakeTab).appendRow([50, 42, "I-0003", "x", "Buyer 42", `'${e164(42)}`, "active", "2026-11-01T10:00:00.000Z", null, null, null, null, null, null]);
    expect(ask(ss, "")).toEqual(NOT_FOUND);
    expect(ask(ss, "'")).toEqual(NOT_FOUND);
  });

  it("does not match a token against any other column of Bookings (idempotency key, name)", () => {
    const ss = build(SEED);
    expect(ask(ss, "key-1")).toEqual(NOT_FOUND);
    expect(ask(ss, "Buyer 1")).toEqual(NOT_FOUND);
  });

  it("answers not-reserving when the sheet has no Claims tab (status mode)", () => {
    const ss = build(SEED);
    ss.tabs = ss.tabs.filter((t) => t.name !== "Claims");
    expect(ask(ss, tokenOf(1))).toEqual({ ok: false, error: "not-reserving" });
  });
});

describe("booking: what it must never reveal (D-009, D-011, T-12)", () => {
  it("contains no number, no other buyer's name, token, claim or booking, and the seller's number only inside whatsappUrl", () => {
    const r = ask(build(SEED), tokenOf(2)) as { whatsappUrl: string };
    const { whatsappUrl, ...rest } = r;
    expect(whatsappUrl).toContain(SELLER_DIGITS);
    const body = JSON.stringify(rest);
    for (let n = 1; n <= 9; n++) expect(body, `number ${n}`).not.toContain(digits(n));
    expect(body).not.toContain(SELLER_DIGITS);
    for (const other of [1, 3, 4, 5]) {
      expect(body).not.toContain(`Buyer ${other}`);
      expect(body).not.toContain(tokenOf(other));
    }
    // The whole answer, whatsappUrl included, has no buyer number and no other buyer's name or token.
    const all = JSON.stringify(r) + decodeURIComponent(whatsappUrl);
    for (let n = 1; n <= 9; n++) expect(all).not.toContain(digits(n));
    expect(all).not.toContain("Buyer 1");
    expect(all).not.toContain(tokenOf(1));
  });

  it("lists only this booking's claim ids, never another buyer's", () => {
    const r = ask(build(SEED), tokenOf(2)) as { booking: Record<string, { claimIds?: number[]; claimId?: number }[] | unknown> };
    const ids = [
      ...(r.booking.reserved as { claimIds: number[] }[]).flatMap((l) => l.claimIds),
      ...(r.booking.waiting as { claimId: number }[]).map((l) => l.claimId),
      ...(r.booking.sold as { claimIds: number[] }[]).flatMap((l) => l.claimIds),
      ...(r.booking.ended as { claimIds: number[] }[]).flatMap((l) => l.claimIds),
    ];
    expect(ids).toEqual([6]);
  });

  it("has exactly the designed keys, so nothing extra (a row, a Created time, a Message link) can slip in", () => {
    const r = ask(build(SEED), tokenOf(1)) as { booking: Record<string, unknown> };
    expect(Object.keys(r).sort()).toEqual(["booking", "ok", "whatsappUrl"]);
    expect(Object.keys(r.booking).sort()).toEqual(["bookingId", "ended", "name", "reserved", "sold", "waiting"]);
  });
});

describe("booking: read-only, no lock", () => {
  it("writes nothing, flushes nothing, clears no cache and never touches the lock", () => {
    const h = harness(build(SEED), {
      lock: { waitLock: () => { throw new Error("must not lock"); }, releaseLock: () => { throw new Error("must not release"); } },
    });
    const before = h.ss.snapshot();
    const r = booking(h.ss, { token: tokenOf(1) }, h.deps as never);
    expect(r).toMatchObject({ ok: true });
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
    expect(h.events).not.toContain("flush");
    expect(h.events.filter((e) => e.startsWith("cache:"))).toEqual([]);
    expect(h.events).not.toContain("waitLock");
  });

  it("asking twice gives the same answer", () => {
    const ss = build(SEED);
    expect(ask(ss, tokenOf(2))).toEqual(ask(ss, tokenOf(2)));
  });
});
