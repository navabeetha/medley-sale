// S-14: the back-out API (brief 2.7, 4.3, 6.1 rules 3, 5, 6, 8, 6.4; D-005, D-010, D-011, D-026, D-039; scenarios T-02, T-04, T-05).
// In-memory fake sheet, synthetic data only.
//
// DESIGNED INTERFACE (the spec for src/api/back-out.ts; sync like the rest of src/api; the UI track builds against it):
//
//   backOut(ss: Spreadsheet, request: unknown, deps: BackOutDeps): BackOutResponse
//
//   BackOutDeps = SellerDeps plus the seller's number:
//     { lock: { waitLock(ms): void; releaseLock(): void }, cache: { remove(key): void }, now: () => string,
//       siteUrl: string, sellerWhatsapp?: string }
//
//   Request: { token: string, claimId: number }   (the parsed body; `action` is ignored here; the token is in the body only)
//
//   Success: { ok: true, booking: BookingView, whatsappUrl: string | null, tellSellerUrl: string | null, backedOutUrl: string | null }   // exactly these keys (G1 added backedOutUrl)
//     booking / whatsappUrl: EXACTLY what booking() answers for that token right after the change (shape documented in
//       booking.test.ts): the claim is now under `ended`, a waiter behind it has moved up.
//     tellSellerUrl: "https://wa.me/<seller digits>?text=<encoded>" to the SELLER, for the optional "Tell the seller" action.
//       The text is short, in the buyer's voice: it names the buyer and says "I've backed out of <item title>", where the title is
//       the item name followed by " (<brand>)", or "<name> by <author>" for a book (as buildMessage words it). It carries no number
//       and no private link. null when SELLER_WHATSAPP is not a valid number (the back-out still happens).
//   Failure: { ok: false, error: <code> }, exactly these keys, NOTHING written:
//     "not-found"     the token matches no booking, OR the claim id is missing / not a whole number / matches no claim, OR the
//                     claim belongs to another booking. All the same answer, so nothing is revealed about other buyers' claims.
//     "not-allowed"   the claim is SOLD (the seller sold it; only the seller can undo that). Smaller reading: any state other than
//                     active and released is refused; released is the idempotent case below.
//     "not-reserving" no Claims or no Bookings tab (status mode); no lock taken.
//     "busy"          waitLock threw; nothing written.
//
//   Lock and order (6.1 rule 6, as reserve and the seller-sheet handlers): waitLock (> 0 ms, 30 s) FIRST, then every read of the
//     token, the claim and the queue, then the writes, then ss.flush() after the last write, then cache.remove(CATALOGUE_CACHE_KEY),
//     then releaseLock in an outer finally (a throwing write or flush still releases it; a throwing releaseLock or cache.remove
//     never changes the answer). Every response that took the lock releases it. When nothing was written (refused, not found,
//     repeated request) there is no flush and no cache removal.
//
//   Writes, for a claim of this booking whose State is active:
//     - State = "released"; "Ended at" = now() when the Claims tab has that column (no error when it doesn't).
//     - Everything the seller-sheet logic does for an item (src/api/seller-sheet.ts applyItem): previousRole of every claim comes
//       from a recalculation of the claims AS THEY WERE BEFORE the write (D-026.2), so
//         * a HOLDER backing out stamps `Promoted at` = now() on the waiter who moves up (so they appear in To do; a stale
//           Notified tick on that row is cleared) and clears the leaver's own stamp (6.1.3);
//         * a WAITER leaving stamps NOBODY (no seller task), and the waiters behind them move up a place;
//       Status and Person of the item row are rewritten; Message link of the item's claims follows.
//     Claims are found by Claim ID, never by row position.
//   Repeated request (the claim is already released): { ok: true, ... } with the SAME shape and content, nothing written,
//     no second promotion, "Ended at" untouched.
//   Rejoining after a back-out is a new reserve (rule 6.1.5, T-04): the released claim is never reused.
import { describe, expect, it } from "vitest";
import { backOut } from "../../src/api/back-out";
import { booking } from "../../src/api/booking";
import { CATALOGUE_CACHE_KEY } from "../../src/api/handle-get";
import { reserve } from "../../src/api/reserve";
import type { FakeTab } from "../fixtures/fake-sheet";
import { counterRandom, FakeSpreadsheet } from "../fixtures/fake-sheet";
import {
  CLAIM_HEADERS, LATER, NOW, SELLER_DIGITS, SELLER_PROPERTY, SITE, STAMP, blank, build, claimRow, digits, e164, harness, itemRow, stamp,
  stateOf, tokenOf, type Harness, type SeedClaim,
} from "../fixtures/queue-sheet";

const back = (h: Harness, token: unknown, claimId: unknown, over: Record<string, unknown> = {}) =>
  backOut(h.ss, { token, claimId }, { ...h.deps, ...over } as never);
const view = (ss: FakeSpreadsheet, token: string, over: Record<string, unknown> = {}) =>
  booking(ss, { token }, { now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY, ...over } as never);
const NOT_FOUND = { ok: false, error: "not-found" };

// Echo Dot (qty 1): claim 1 holds (stamped), claims 2, 3, 4 wait (4 buyers, booking = claim id).
const LINE: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0001" }, { id: 4, item: "I-0001" }];

describe("backOut: a holder backs out (T-02, rule 6.1.3)", () => {
  it("releases the claim, fills Ended at, and promotes the next waiter with a Promoted at stamp so they show in To do", () => {
    const h = harness(build(LINE));
    const r = back(h, tokenOf(1), 1);
    expect(r).toMatchObject({ ok: true });
    expect(stateOf(h.ss, 1)).toBe("released");
    expect(claimRow(h.ss, 1)["Ended at"]).toBe(NOW);
    expect(stamp(h.ss, 1)).toBeNull(); // no longer a holder: its stamp goes (rule 3)
    expect(stamp(h.ss, 2)).toBe(NOW); // the waiter who moved up
    expect(stamp(h.ss, 3)).toBeNull();
    expect(stamp(h.ss, 4)).toBeNull();
    expect(claimRow(h.ss, 2).Notified).toBeNull(); // To do lists a holder until Notified is ticked
  });

  it("clears an old Notified tick on the promoted waiter so the new To do row is not hidden", () => {
    const h = harness(build([{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001", notified: true }]));
    back(h, tokenOf(1), 1);
    expect(stamp(h.ss, 2)).toBe(NOW);
    expect(blank(claimRow(h.ss, 2).Notified)).toBe(true);
  });

  it("rewrites the item's Status and Person through the seller-sheet logic", () => {
    const h = harness(build(LINE));
    back(h, tokenOf(1), 1);
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
    const solo = harness(build([{ id: 1, item: "I-0001", promoted: STAMP }]));
    back(solo, tokenOf(1), 1);
    expect(itemRow(solo.ss, "Tech", "I-0001")).toMatchObject({ Status: "Available", Person: null });
  });

  it("T-02: quantity 3, 5 claims, the second holder backs out: the fourth claim becomes holder, the fifth stays waiting", () => {
    const h = harness(build([1, 2, 3, 4, 5].map((id) => ({ id, item: "I-0002" }))));
    const r = back(h, tokenOf(2), 2);
    expect(r).toMatchObject({ ok: true });
    expect(stateOf(h.ss, 2)).toBe("released");
    expect(stamp(h.ss, 4)).toBe(NOW);
    expect(stamp(h.ss, 5)).toBeNull();
    expect(stamp(h.ss, 1)).toBeNull(); // the other holders keep what they had
    expect(stamp(h.ss, 3)).toBeNull();
    expect(view(h.ss, tokenOf(4))).toMatchObject({ booking: { reserved: [{ claimIds: [4] }], waiting: [] } });
    expect(view(h.ss, tokenOf(5))).toMatchObject({ booking: { reserved: [], waiting: [{ claimId: 5, position: 1 }] } });
    expect(itemRow(h.ss, "Tech", "I-0002").Person).toBe("Buyer 1, Buyer 3, Buyer 4");
  });

  it("a multi-unit buyer backing out of one unit keeps the other: the line shrinks from × 2 to × 1 and Ended gains one", () => {
    // Frames qty 3: booking 1 holds claims 1 and 2, booking 2 holds claim 3, booking 3 waits (claim 4).
    const h = harness(build([
      { id: 1, item: "I-0002" }, { id: 2, item: "I-0002", booking: 1 }, { id: 3, item: "I-0002", booking: 2 }, { id: 4, item: "I-0002", booking: 3 },
    ]));
    const r = back(h, tokenOf(1), 1) as { booking: { reserved: { quantity: number; claimIds: number[] }[]; ended: { quantity: number; claimIds: number[] }[] } };
    expect(r.booking.reserved).toMatchObject([{ quantity: 1, claimIds: [2] }]);
    expect(r.booking.ended).toMatchObject([{ quantity: 1, claimIds: [1] }]);
    expect(stateOf(h.ss, 2)).toBe("active");
    expect(stamp(h.ss, 4)).toBe(NOW);
  });

  it("finds the claim by Claim ID on a sorted Claims tab", () => {
    const ss = build(LINE);
    const t = ss.getTab("Claims") as FakeTab;
    t.grid = [t.grid[0]!, ...t.grid.slice(1).reverse()];
    const h = harness(ss);
    expect(back(h, tokenOf(1), 1)).toMatchObject({ ok: true });
    expect(stateOf(ss, 1)).toBe("released");
    expect(stamp(ss, 2)).toBe(NOW);
    expect(stamp(ss, 3)).toBeNull();
  });

  it("works when the Claims tab has no Ended at column", () => {
    const headers = CLAIM_HEADERS.filter((c) => c !== "Ended at");
    const h = harness(build(LINE, headers));
    expect(back(h, tokenOf(1), 1)).toMatchObject({ ok: true });
    expect(stateOf(h.ss, 1)).toBe("released");
    expect(stamp(h.ss, 2)).toBe(NOW);
  });
});

describe("backOut: a waiter leaves (rule 6.1.3: no seller task)", () => {
  it("releases the claim, moves the waiters behind up a place, and stamps Promoted at on nobody", () => {
    const h = harness(build(LINE));
    const r = back(h, tokenOf(2), 2);
    expect(r).toMatchObject({ ok: true });
    expect(stateOf(h.ss, 2)).toBe("released");
    expect(claimRow(h.ss, 2)["Ended at"]).toBe(NOW);
    expect(view(h.ss, tokenOf(3))).toMatchObject({ booking: { waiting: [{ claimId: 3, position: 1 }] } });
    expect(view(h.ss, tokenOf(4))).toMatchObject({ booking: { waiting: [{ claimId: 4, position: 2 }] } });
    // No new stamp anywhere: the holder keeps its old one, nobody else has one.
    expect(stamp(h.ss, 1)).toBe(STAMP);
    for (const id of [2, 3, 4]) expect(stamp(h.ss, id)).toBeNull();
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 1" });
  });

  it("a waiter on a sold-out item can leave too, and nobody is promoted", () => {
    const h = harness(build([
      { id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0001" },
    ]));
    expect(view(h.ss, tokenOf(2))).toMatchObject({ booking: { waiting: [{ claimId: 2, itemSold: true }] } });
    expect(back(h, tokenOf(2), 2)).toMatchObject({ ok: true, booking: { waiting: [], ended: [{ claimIds: [2] }] } });
    expect(stamp(h.ss, 3)).toBeNull();
    expect(stateOf(h.ss, 1)).toBe("sold");
    expect(itemRow(h.ss, "Tech", "I-0001").Status).toBe("Sold");
  });
});

describe("backOut: the answer", () => {
  it("returns exactly the designed keys, and the booking is what booking() answers afterwards", () => {
    const h = harness(build(LINE));
    const r = back(h, tokenOf(1), 1) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["backedOutUrl", "booking", "ok", "tellSellerUrl", "whatsappUrl"]);
    const after = view(h.ss, tokenOf(1)) as { booking: unknown; whatsappUrl: unknown };
    expect(r.booking).toEqual(after.booking);
    expect(r.whatsappUrl).toEqual(after.whatsappUrl);
    expect(r.booking).toMatchObject({ bookingId: 1, reserved: [], waiting: [], ended: [{ itemId: "I-0001", quantity: 1, claimIds: [1] }] });
    expect(r.whatsappUrl).toBeNull(); // nothing active left to message about
  });

  describe("tellSellerUrl (the optional 'Tell the seller' action; D-011)", () => {
    const parse = (r: unknown) => {
      const u = new URL((r as { tellSellerUrl: string }).tellSellerUrl);
      return { u, text: u.searchParams.get("text") ?? "" };
    };

    it("is a wa.me link to the seller saying the buyer backed out of the item, with its brand", () => {
      const h = harness(build(LINE));
      const { u, text } = parse(back(h, tokenOf(1), 1));
      expect(`${u.origin}${u.pathname}`).toBe(`https://wa.me/${SELLER_DIGITS}`);
      expect(text).toContain("I've backed out of Echo Dot (Zorbo)");
      expect(text).toContain("Buyer 1");
      expect(text.length).toBeLessThan(300); // short
    });

    it("words a book as 'Name by Author'", () => {
      const h = harness(build([{ id: 1, item: "I-0006" }]));
      expect(parse(back(h, tokenOf(1), 1)).text).toContain("I've backed out of Tiny Atlas by Author Q");
    });

    it("carries no buyer number and no private link or token", () => {
      const h = harness(build(LINE));
      const { text } = parse(back(h, tokenOf(1), 1));
      expect(text).not.toContain(digits(1));
      expect(text).not.toContain(tokenOf(1));
      expect(text).not.toContain("/#/b/");
    });

    it("keeps the seller's number out of everything but the two URLs, and the buyer's number out of the answer entirely", () => {
      const h = harness(build(LINE));
      const r = back(h, tokenOf(1), 1) as Record<string, unknown>;
      const { tellSellerUrl, whatsappUrl, ...rest } = r;
      expect(String(tellSellerUrl)).toContain(SELLER_DIGITS);
      expect(JSON.stringify(rest)).not.toContain(SELLER_DIGITS);
      expect(JSON.stringify(r)).not.toContain(digits(1));
      expect(JSON.stringify(r)).not.toContain(e164(1));
      expect(String(whatsappUrl ?? "")).not.toContain("tok-");
    });

    it("is null when SELLER_WHATSAPP is missing or invalid, and the back-out still happens", () => {
      for (const sellerWhatsapp of [undefined, "", "12", "not a number"]) {
        const h = harness(build(LINE), { sellerWhatsapp });
        const r = back(h, tokenOf(1), 1);
        expect(r, String(sellerWhatsapp)).toMatchObject({ ok: true, tellSellerUrl: null });
        expect(stateOf(h.ss, 1)).toBe("released");
      }
    });

    it("is also given on the repeated request, and a refusal or not-found has none", () => {
      const h = harness(build(LINE));
      back(h, tokenOf(1), 1);
      expect(back(h, tokenOf(1), 1)).toMatchObject({ ok: true, tellSellerUrl: expect.stringContaining(`wa.me/${SELLER_DIGITS}`) });
      expect(back(h, "nope", 1)).not.toHaveProperty("tellSellerUrl");
    });
  });
});

describe("backOut: a repeated request (idempotent)", () => {
  it("answers ok with the same result, writes nothing, and promotes nobody a second time", () => {
    const h = harness(build(LINE));
    const first = back(h, tokenOf(1), 1);
    const snapshot = h.ss.snapshot();
    h.events.length = 0;
    const second = back(h, tokenOf(1), 1, { now: () => LATER });
    expect(second).toEqual(first);
    expect(h.ss.snapshot()).toBe(snapshot);
    expect(h.events).not.toContain("write");
    expect(h.events).not.toContain("flush");
    expect(claimRow(h.ss, 1)["Ended at"]).toBe(NOW); // not LATER
    expect(stamp(h.ss, 2)).toBe(NOW);
    expect(stamp(h.ss, 3)).toBeNull();
  });

  it("is idempotent for a claim the seller released in the sheet, too (no Ended at invented)", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "released" }, { id: 2, item: "I-0001" }]));
    const before = h.ss.snapshot();
    expect(back(h, tokenOf(1), 1)).toMatchObject({ ok: true, booking: { ended: [{ claimIds: [1] }] } });
    expect(h.ss.snapshot()).toBe(before);
  });
});

describe("backOut: refusals and unknowns write nothing", () => {
  it("refuses a sold claim with not-allowed", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }]));
    const before = h.ss.snapshot();
    expect(back(h, tokenOf(1), 1)).toEqual({ ok: false, error: "not-allowed" });
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
    expect(h.events).not.toContain("flush");
    expect(h.events.filter((e) => e.startsWith("cache:"))).toEqual([]);
  });

  it("answers not-found, identically, for an unknown token, an unknown claim and another booking's claim", () => {
    const h = harness(build(LINE));
    const before = h.ss.snapshot();
    expect(back(h, "0123456789abcdef0123456789abcdef", 1)).toEqual(NOT_FOUND);
    expect(back(h, tokenOf(1), 99)).toEqual(NOT_FOUND);
    expect(back(h, tokenOf(1), 2)).toEqual(NOT_FOUND); // claim 2 is booking 2's
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  });

  it.each([
    ["no claim id", undefined], ["a string claim id", "1"], ["a fractional claim id", 1.5], ["zero", 0], ["a negative id", -1],
    ["null", null], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY], ["an object", { a: 1 }], ["an array", [1]],
  ])("answers not-found, never an error that hints at the format, for %s", (_label, claimId) => {
    const h = harness(build(LINE));
    const before = h.ss.snapshot();
    expect(JSON.stringify(back(h, tokenOf(1), claimId))).toBe(JSON.stringify(NOT_FOUND));
    expect(h.ss.snapshot()).toBe(before);
  });

  it.each([["missing", undefined], ["empty", ""], ["a number", 1], ["an object", {}], ["an apostrophe-prefixed real token", `'${tokenOf(1)}`]])(
    "answers not-found for a %s token",
    (_label, token) => {
      const h = harness(build(LINE));
      const before = h.ss.snapshot();
      expect(back(h, token, 1)).toEqual(NOT_FOUND);
      expect(h.ss.snapshot()).toBe(before);
    },
  );

  it("answers not-found for a non-object request", () => {
    const h = harness(build(LINE));
    for (const request of [undefined, null, "x", 3, []]) expect(backOut(h.ss, request, h.deps as never)).toEqual(NOT_FOUND);
  });

  it("answers not-reserving, without taking the lock, when the sheet has no Claims tab", () => {
    const ss = build(LINE);
    ss.tabs = ss.tabs.filter((t) => t.name !== "Claims");
    const h = harness(ss);
    expect(back(h, tokenOf(1), 1)).toEqual({ ok: false, error: "not-reserving" });
    expect(h.events).not.toContain("waitLock");
  });

  it("only the owner's token can back out: another buyer's token with the right claim id changes nothing", () => {
    const h = harness(build(LINE));
    const before = h.ss.snapshot();
    expect(back(h, tokenOf(3), 1)).toEqual(NOT_FOUND);
    expect(h.ss.snapshot()).toBe(before);
  });
});

describe("backOut: the script lock (6.1 rule 6)", () => {
  it("takes the lock before any read, flushes after the last write, clears the catalogue cache, then releases once", () => {
    const h = harness(build(LINE));
    back(h, tokenOf(1), 1);
    const e = h.events;
    expect(e.indexOf("waitLock")).toBe(0); // nothing, not even the token lookup, happens before the lock
    expect(e.indexOf("write")).toBeGreaterThan(e.indexOf("waitLock"));
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    const cache = e.indexOf(`cache:${CATALOGUE_CACHE_KEY}`);
    expect(cache).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(e.indexOf("flush"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(cache);
    expect(e.filter((x) => x === "waitLock")).toHaveLength(1);
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
    expect(e.filter((x) => x === "flush")).toHaveLength(1);
    expect(e.filter((x) => x.startsWith("cache:"))).toEqual([`cache:${CATALOGUE_CACHE_KEY}`]);
  });

  it("asks for a lock wait of more than 0 ms", () => {
    let asked = -1;
    const h = harness(build(LINE), { lock: { waitLock: (ms: number) => { asked = ms; }, releaseLock: () => {} } });
    back(h, tokenOf(1), 1);
    expect(asked).toBeGreaterThan(0);
  });

  it("answers busy and writes nothing when the lock cannot be taken", () => {
    const h = harness(build(LINE), { lock: { waitLock: () => { throw new Error("timeout"); }, releaseLock: () => {} } });
    const before = h.ss.snapshot();
    expect(back(h, tokenOf(1), 1)).toEqual({ ok: false, error: "busy" });
    expect(h.ss.snapshot()).toBe(before);
    expect(h.events).not.toContain("write");
  });

  it("releases the lock exactly as often as it took it, on every outcome", () => {
    const calls: [unknown, unknown][] = [[tokenOf(1), 1], [tokenOf(1), 1], [tokenOf(1), 99], ["nope", 1], [tokenOf(2), 2]];
    for (const [token, claimId] of calls) {
      const h = harness(build(LINE));
      back(h, tokenOf(1), 1); // so the second call is a repeat
      h.events.length = 0;
      back(h, token, claimId);
      expect(h.events.filter((x) => x === "releaseLock").length, `${String(token)} ${String(claimId)}`).toBe(h.events.filter((x) => x === "waitLock").length);
    }
    const sold = harness(build([{ id: 1, item: "I-0001", state: "sold", soldAt: STAMP }]));
    back(sold, tokenOf(1), 1);
    expect(sold.events.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("releases the lock when a write throws, and still clears the cache", () => {
    const h = harness(build(LINE));
    (h.ss.getTab("Claims") as FakeTab).setCell = () => { throw new Error("quota"); };
    try { back(h, tokenOf(1), 1); } catch { /* throw or answer: the lock must be freed either way */ }
    expect(h.events.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("releases the lock when flush throws, and still clears the cache (the R2 pattern)", () => {
    const h = harness(build(LINE));
    h.ss.flush = () => { throw new Error("flush failed"); };
    try { back(h, tokenOf(1), 1); } catch { /* ignore */ }
    expect(h.events.filter((x) => x === "releaseLock")).toHaveLength(1);
    expect(h.events).toContain(`cache:${CATALOGUE_CACHE_KEY}`);
  });

  it("still answers ok when releaseLock or cache removal throws (the change is saved)", () => {
    const a = harness(build(LINE), { lock: { waitLock: () => {}, releaseLock: () => { throw new Error("gone"); } } });
    expect(back(a, tokenOf(1), 1)).toMatchObject({ ok: true });
    const b = harness(build(LINE), { cache: { remove: () => { throw new Error("cache down"); } } });
    expect(back(b, tokenOf(1), 1)).toMatchObject({ ok: true });
    expect(stateOf(b.ss, 1)).toBe("released");
  });
});

describe("backOut: T-04 a backed-out person reserves again and joins the end", () => {
  it("gets a new, later claim behind the existing waiters; the old claim stays released", () => {
    const h = harness(build(LINE));
    back(h, tokenOf(1), 1);
    const reserveDeps = { ...h.deps, randomBytes: counterRandom(7).fn };
    const r = reserve(h.ss, {
      name: "Buyer 1", number: e164(1), idempotencyKey: "retry-key-0000001", items: [{ id: "I-0001", quantity: 1 }],
    }, reserveDeps as never) as { ok: true; units: { claimId: number; outcome: string; position: number }[] };
    expect(r.ok).toBe(true);
    expect(r.units).toMatchObject([{ claimId: 5, outcome: "waiting", position: 3 }]); // after waiters 3 and 4, behind new holder 2
    expect(stateOf(h.ss, 1)).toBe("released");
    expect(stamp(h.ss, 2)).toBe(NOW);
    expect(view(h.ss, tokenOf(2))).toMatchObject({ booking: { reserved: [{ claimIds: [2] }] } });
  });
});

describe("backOut and the seller at the same moment (T-05, consistent under the lock)", () => {
  it("the seller's sale lands first: the buyer's back-out is then refused, the sale stands and nobody is promoted", () => {
    const h = harness(build(LINE));
    expect(h.edit(1, "sold")).toEqual({ handled: true, reverted: false });
    expect(back(h, tokenOf(1), 1)).toEqual({ ok: false, error: "not-allowed" });
    expect(stateOf(h.ss, 1)).toBe("sold");
    expect(stamp(h.ss, 2)).toBeNull();
    expect(itemRow(h.ss, "Tech", "I-0001").Status).toBe("Sold");
  });

  it("the buyer's back-out lands first: the seller's later attempt to mark that claim sold is reverted with a reason", () => {
    const h = harness(build(LINE));
    expect(back(h, tokenOf(1), 1)).toMatchObject({ ok: true });
    const r = h.edit(1, "sold", { oldValue: "released" });
    expect(r).toMatchObject({ handled: true, reverted: true });
    expect(stateOf(h.ss, 1)).toBe("released");
    expect(stamp(h.ss, 2)).toBe(NOW); // the promotion stands
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
  });

  it("the seller sells the waiter who was just promoted: allowed, and the quantity stays consistent", () => {
    const h = harness(build(LINE));
    back(h, tokenOf(1), 1);
    expect(h.edit(2, "sold")).toEqual({ handled: true, reverted: false });
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Sold", Person: "Buyer 2" });
    expect(stateOf(h.ss, 3)).toBe("active");
    expect(view(h.ss, tokenOf(3))).toMatchObject({ booking: { waiting: [{ claimId: 3, itemSold: true }] } });
  });
});
