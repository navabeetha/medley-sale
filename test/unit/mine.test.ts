// S-19: the `mine` API action, one request for every booking saved on a device ("My reservations" view). Red step:
// written before the code, so every test here must fail until src/api/mine.ts exists.
//
// DESIGNED INTERFACE (new file src/api/mine.ts, same dependencies as booking(), so it is read-only and takes no lock):
//   mine(ss: Spreadsheet, request: unknown, deps: BookingDeps): MineResponse
//   request   { action: "mine", tokens: string[] }   (handle-post passes the parsed object, like booking)
//   answer    { ok: true,
//               reserved:  Array<Line & { token }>,         held units, one line per ITEM PER BOOKING (claimIds all of one
//                                                           booking), exactly booking()'s `reserved` lines plus the token
//               waiting:   Array<WaitingLine & { token }>,  booking()'s `waiting` entries plus the token
//               sold:      Array<Line & { token }>,
//               backedOut: Array<Line & { token }>,         released AND Ended at set (the buyer's own back-outs, as in
//                                                           backedOutUrl); a seller's hand release is NOT here
//               notFound:  string[],                        tokens that matched nothing, in the order sent, no repeats
//               whatsappUrl: string | null,                 ONE buyer-voice message for every reserved + waiting unit
//               backedOutUrl: string | null }               ONE message for every backed-out unit
//             | { ok: false, error: "invalid-request" | "not-reserving" }
//   The line `token` is the token the client sent for that unit's booking (Back out needs it). Nothing else identifies a booking:
//   no booking id, no name, no number, no row numbers.
//
// RULES PINNED (see the story, S-19 criterion 2 and 4):
//   - tokens: an array of 1 to 20 non-empty strings; anything else is invalid-request, answered BEFORE any sheet read and
//     with no lock. (ASSUMED: an empty array is invalid too: there is nothing to ask.) Repeats are asked once.
//   - status mode (no Claims or Bookings tab) answers not-reserving, like booking().
//   - never any data for a token that was not sent; an unknown token is only listed in notFound.
//   - whatsappUrl: the buyer's name in "Hi! I'm <name>" is the FIRST FOUND token's booking (ASSUMED: the newest, as the
//     site sends newest first). Items merge by item across bookings ("× 3"), brands via title(). It ends with one
//     "Change or back out: <site>/#/b/<token>" line per booking that has something reserved or waiting (ASSUMED: a booking
//     with only sold or backed-out items gets no link line), and stays under 2,000 characters by dropping bullets, never
//     link lines, with "…and N more".
//   - backedOutUrl: lists every backed-out item across the bookings, like booking()'s, with no token or private link.
//   - both URLs are null when their section is empty or SELLER_WHATSAPP is invalid; whatsappUrl is null without a valid SITE_URL.
import { beforeEach, describe, expect, it } from "vitest";
import { booking } from "../../src/api/booking";
import { FakeSpreadsheet, type FakeTab } from "../fixtures/fake-sheet";
import {
  ITEM_HEADERS, NOW, SELLER_DIGITS, SELLER_PROPERTY, SITE, build, digits, e164, harness, nameOf, seed, tokenOf, type SeedClaim,
} from "../fixtures/queue-sheet";

// src/api/mine.ts does not exist yet. It is loaded by path (as s13-wa-opened.test.ts does for wa-opened.ts) so that
// `tsc` stays green in the red step; a missing module makes every test below fail with the stub's message.
type Mine = (ss: unknown, request: unknown, deps: unknown) => unknown;
const mine: Mine = await (async (): Promise<Mine> => {
  try {
    const modPath = new URL("../../src/api/mine.ts", import.meta.url).pathname;
    return ((await import(/* @vite-ignore */ modPath)) as { mine: Mine }).mine;
  } catch {
    return () => { throw new Error("src/api/mine.ts is missing: mine() is not implemented yet"); };
  }
})();

const WHEN = "2026-11-05T09:00:00.000Z";
const deps = (over: Record<string, unknown> = {}) => ({ now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY, ...over }) as never;
type Out = Record<string, unknown> & { ok: boolean };
const ask = (ss: FakeSpreadsheet, tokens: unknown, over: Record<string, unknown> = {}): Out =>
  mine(ss, { action: "mine", tokens }, deps(over)) as unknown as Out;
const list = (o: Out, key: string) => o[key] as Array<Record<string, unknown>>;
const textOf = (url: unknown): string => new URL(String(url)).searchParams.get("text") ?? "";
const T1 = tokenOf(1), T2 = tokenOf(2), T3 = tokenOf(3);

// Echo Dot qty 1 (I-0001), Picture frame qty 3 (I-0002), Yoga mat qty 2 (I-0003), Lamp qty 0 (I-0004), Mystery box (I-0008, no
// price), book Tiny Atlas (I-0006), as build() makes them.
//   Buyer 1: 2 frames held (1, 2), a yoga mat bought (3), backed out of the book (4), the lamp released by the seller (5, no
//            Ended at), waiting 1st for the Echo Dot (8).
//   Buyer 2: 1 frame held (6), holds the Echo Dot (7), backed out of the Mystery box (9).
//   Buyer 3: holds a yoga mat (10) and the book (11). Never sent unless a test says so.
const SEED: SeedClaim[] = [
  { id: 1, booking: 1, item: "I-0002" },
  { id: 2, booking: 1, item: "I-0002" },
  { id: 3, booking: 1, item: "I-0003", state: "sold", soldPrice: 1000, soldAt: WHEN },
  { id: 4, booking: 1, item: "I-0006", state: "released", endedAt: WHEN },
  { id: 5, booking: 1, item: "I-0004", state: "released" },
  { id: 6, booking: 2, item: "I-0002" },
  { id: 7, booking: 2, item: "I-0001" },
  { id: 8, booking: 1, item: "I-0001" },
  { id: 9, booking: 2, item: "I-0008", state: "released", endedAt: WHEN },
  { id: 10, booking: 3, item: "I-0003" },
  { id: 11, booking: 3, item: "I-0006" },
];
const sheet = () => build(SEED);
const withToken = (lines: unknown, token: string) => (lines as Array<Record<string, unknown>>).map((l) => ({ ...l, token }));

describe("mine(): request validation", () => {
  const BAD: Array<[string, unknown]> = [
    ["no tokens key", undefined],
    ["tokens that is not an array", T1],
    ["tokens as an object", { 0: T1 }],
    ["an empty array", []],
    ["a non-string among the tokens", [T1, 5]],
    ["a null among the tokens", [T1, null]],
    ["an empty-string token", [T1, ""]],
    ["21 tokens", Array.from({ length: 21 }, (_, i) => `tok-${String(i).padStart(4, "0")}`)],
  ];
  it.each(BAD)("answers invalid-request for %s, with no lock, no read and no write", (_label, tokens) => {
    const h = harness(sheet());
    const r = mine(h.ss, { action: "mine", tokens }, h.deps as never) as unknown;
    expect(r).toEqual({ ok: false, error: "invalid-request" });
    expect(h.events).toEqual([]);
  });

  it.each([["null", null], ["undefined", undefined], ["a string", "mine"], ["an array", [T1]]])(
    "answers invalid-request when the request itself is %s",
    (_label, request) => {
      expect(mine(sheet(), request, deps())).toEqual({ ok: false, error: "invalid-request" });
    },
  );

  it("accepts exactly 20 tokens, and ignores other keys in the request", () => {
    const tokens = [T1, ...Array.from({ length: 19 }, (_, i) => `nope-${String(i).padStart(4, "0")}`)];
    const r = mine(sheet(), { action: "mine", tokens, extra: "x" }, deps()) as unknown as Out;
    expect(r.ok).toBe(true);
    expect(r.notFound).toHaveLength(19);
  });

  it("answers not-reserving when the sheet has no Claims or Bookings tab (status mode)", () => {
    const ss = new FakeSpreadsheet("Synthetic status sheet");
    ss.withTab("Tech", [["Synthetic title row"], [...ITEM_HEADERS]]);
    expect(ask(ss, [T1])).toEqual({ ok: false, error: "not-reserving" });
  });
});

describe("mine(): read-only", () => {
  it("takes no lock, writes nothing, flushes nothing and clears no cache", () => {
    const h = harness(sheet());
    mine(h.ss, { action: "mine", tokens: [T1, T2, "nope"] }, h.deps as never);
    expect(h.events.length).toBeGreaterThan(0); // it did read
    expect(h.events.filter((e) => e !== "read")).toEqual([]);
  });

  it("stamps nobody and leaves the sheet as it was", () => {
    const ss = sheet();
    const before = JSON.stringify(ss.tabs.map((t) => t.getGrid()));
    ask(ss, [T1, T2]);
    expect(JSON.stringify(ss.tabs.map((t) => t.getGrid()))).toBe(before);
  });

  it("answers the same twice", () => {
    expect(ask(sheet(), [T1, T2])).toEqual(ask(sheet(), [T1, T2]));
  });
});

describe("mine(): merging bookings", () => {
  let r!: Out;
  beforeEach(() => { r = ask(sheet(), [T1, T2]); }); // inside beforeEach so a missing mine() fails each test, not the file

  it("answers exactly ok, the four sections, notFound and the two URLs", () => {
    expect(Object.keys(r).sort()).toEqual(["backedOut", "backedOutUrl", "notFound", "ok", "reserved", "sold", "waiting", "whatsappUrl"]);
    expect(r.ok).toBe(true);
    expect(r.notFound).toEqual([]);
  });

  it("lists held units per booking, each line carrying its own booking's token and claim ids", () => {
    const reserved = list(r, "reserved");
    // Buyer 1's two frames are one line (x2); Buyer 2's frame is a separate line, because Back out needs Buyer 2's token.
    expect(reserved).toHaveLength(3);
    const frame1 = reserved.find((l) => l.token === T1)!;
    expect(frame1).toMatchObject({ itemId: "I-0002", name: "Picture frame", detail: "Framex", quantity: 2, claimIds: [1, 2] });
    const frame2 = reserved.find((l) => l.token === T2 && l.itemId === "I-0002")!;
    expect(frame2).toMatchObject({ quantity: 1, claimIds: [6] });
    expect(reserved.find((l) => l.itemId === "I-0001")).toMatchObject({ token: T2, claimIds: [7], name: "Echo Dot", detail: "Zorbo" });
  });

  it("lists waiting units with their position and their booking's token", () => {
    expect(list(r, "waiting")).toEqual([
      { claimId: 8, itemId: "I-0001", name: "Echo Dot", detail: "Zorbo", isBook: false, position: 1, itemSold: false, token: T1 },
    ]);
  });

  it("lists sold units, and only the buyer's own back-outs under backedOut (not the seller's release)", () => {
    expect(list(r, "sold")).toHaveLength(1);
    expect(list(r, "sold")[0]).toMatchObject({ token: T1, itemId: "I-0003", claimIds: [3] });
    const out = list(r, "backedOut");
    expect(out.map((l) => `${String(l.token)}:${String(l.itemId)}`).sort()).toEqual([`${T1}:I-0006`, `${T2}:I-0008`]);
    expect(JSON.stringify(r)).not.toContain("I-0004"); // the lamp the seller released by hand appears nowhere
  });

  it("never puts a unit under two tokens, and every unit's token is one that was sent", () => {
    for (const key of ["reserved", "waiting", "sold", "backedOut"]) for (const l of list(r, key)) expect([T1, T2]).toContain(l.token);
  });

  it("asks a repeated token once: its units are not doubled and it is not listed twice", () => {
    const twice = ask(sheet(), [T1, T1, T2, "nope", "nope"]);
    expect(list(twice, "reserved")).toHaveLength(3);
    expect(twice.notFound).toEqual(["nope"]);
  });

  it("gives the same answer whatever order the tokens are sent in, apart from list order", () => {
    const swapped = ask(sheet(), [T2, T1]);
    const key = (l: Record<string, unknown>) => `${String(l.token)}:${String(l.itemId)}:${JSON.stringify(l.claimIds ?? l.claimId)}`;
    for (const k of ["reserved", "waiting", "sold", "backedOut"]) expect(list(swapped, k).map(key).sort()).toEqual(list(r, k).map(key).sort());
  });
});

describe("mine(): one booking agrees with booking()", () => {
  it("has the same lines, positions and both URLs as the per-token answer", () => {
    const one = ask(sheet(), [T1]);
    const b = booking(sheet(), { token: T1 }, deps()) as unknown as { booking: Record<string, unknown>; whatsappUrl: string; backedOutUrl: string };
    expect(list(one, "reserved")).toEqual(withToken(b.booking.reserved, T1));
    expect(list(one, "waiting")).toEqual(withToken(b.booking.waiting, T1));
    expect(list(one, "sold")).toEqual(withToken(b.booking.sold, T1));
    expect(list(one, "backedOut").map((l) => l.itemId)).toEqual(["I-0006"]);
    expect(one.whatsappUrl).toBe(b.whatsappUrl);
    expect(one.backedOutUrl).toBe(b.backedOutUrl);
  });
});

describe("mine(): notFound and privacy", () => {
  it("lists unknown tokens in notFound, in the order sent, and still answers for the found ones", () => {
    const r = ask(sheet(), ["zzz-unknown", T1, "aaa-unknown"]);
    expect(r.ok).toBe(true);
    expect(r.notFound).toEqual(["zzz-unknown", "aaa-unknown"]);
    expect(list(r, "reserved").every((l) => l.token === T1)).toBe(true);
  });

  it("answers ok with empty sections and null URLs when nothing matches", () => {
    expect(ask(sheet(), ["nope-a", "nope-b"])).toEqual({
      ok: true, reserved: [], waiting: [], sold: [], backedOut: [], notFound: ["nope-a", "nope-b"], whatsappUrl: null, backedOutUrl: null,
    });
  });

  it("treats near-misses as not found: a different case, a padded token, a prefix", () => {
    const near = [T1.toUpperCase(), ` ${T1}`, T1.slice(0, -1), `${T1}x`];
    const r = ask(sheet(), near);
    expect(r.notFound).toEqual(near);
    expect(list(r, "reserved")).toEqual([]);
  });

  it("returns nothing about a booking whose token was not sent", () => {
    const r = ask(sheet(), [T1, T2]);
    const json = JSON.stringify(r) + decodeURIComponent(String(r.whatsappUrl)) + decodeURIComponent(String(r.backedOutUrl));
    for (const secret of [T3, nameOf(3), digits(3), e164(3), "Yoga mat (Kimjaly) × 1"]) expect(json, secret).not.toContain(secret);
    expect(list(r, "reserved").some((l) => l.itemId === "I-0003")).toBe(false); // Buyer 3's yoga mat
    expect(list(r, "backedOut").some((l) => l.itemId === "I-0003")).toBe(false);
  });

  it("returns no booking ids, names, numbers or row numbers, and the seller's number only inside the two URLs", () => {
    const r = ask(sheet(), [T1, T2]);
    const json = JSON.stringify({ ...r, whatsappUrl: null, backedOutUrl: null });
    for (const secret of [digits(1), digits(2), e164(1), e164(2), "Buyer 1", "Buyer 2", SELLER_DIGITS, "bookingId", "row"]) expect(json, secret).not.toContain(secret);
  });

  it("does not echo a hostile token back anywhere but notFound", () => {
    const evil = "<script>x</script>";
    const r = ask(sheet(), [evil]);
    expect(r.notFound).toEqual([evil]);
    expect(JSON.stringify({ ...r, notFound: [] })).not.toContain("script");
  });
});

describe("mine(): the combined whatsappUrl (Reserved)", () => {
  let url: unknown;
  let text = "";
  beforeEach(() => { url = ask(sheet(), [T1, T2]).whatsappUrl; text = textOf(url); });

  it("is a wa.me link to the seller", () => {
    const u = new URL(String(url));
    expect(`${u.origin}${u.pathname}`).toBe(`https://wa.me/${SELLER_DIGITS}`);
  });

  it("speaks as the first token's buyer, in the 2.8 style, with brands via title()", () => {
    expect(text.startsWith("Hi! I'm Buyer 1.")).toBe(true);
    expect(text).toContain("Reserved for me:");
    expect(text).toContain("• Echo Dot (Zorbo)");
    expect(text).toContain("On the waiting list:");
    expect(text).toMatch(/Echo Dot \(Zorbo\), ₹2,500 \(1st in line\)/);
  });

  it("merges the same item across bookings into one bullet with a count", () => {
    // Frames: two from Buyer 1 and one from Buyer 2, at ₹200 each (price 200 from the build() fixture).
    expect(text).toContain("• Picture frame (Framex) × 3, ₹200 each");
    expect(text.split("Picture frame").length - 1).toBe(1);
  });

  it("leaves out sold, backed-out, hand-released and unsent buyers' items", () => {
    for (const gone of ["Yoga mat", "Tiny Atlas", "Mystery box", "Lamp"]) expect(text, gone).not.toContain(gone);
  });

  it("ends with each booking's link line, last", () => {
    expect(text).toContain(`Change or back out: ${SITE}/#/b/${T1}`);
    expect(text).toContain(`Change or back out: ${SITE}/#/b/${T2}`);
    expect(text).not.toContain(T3);
    const lines = text.split("\n").filter((l) => l !== "");
    expect(lines.slice(-2).every((l) => l.startsWith("Change or back out: "))).toBe(true);
  });

  it("has no link line for a booking with nothing reserved or waiting", () => {
    // Buyer 4 only backed out; Buyer 1 holds a frame.
    const ss = build([{ id: 1, booking: 1, item: "I-0002" }, { id: 2, booking: 4, item: "I-0006", state: "released", endedAt: WHEN }]);
    const t = textOf(ask(ss, [tokenOf(1), tokenOf(4)]).whatsappUrl);
    expect(t).toContain(`/#/b/${tokenOf(1)}`);
    expect(t).not.toContain(tokenOf(4));
  });

  it("names the buyer of the first FOUND token when the first one sent is unknown", () => {
    expect(textOf(ask(sheet(), ["nope", T2, T1]).whatsappUrl).startsWith("Hi! I'm Buyer 2.")).toBe(true);
  });

  it("stays under 2,000 characters for a long list, keeps every link line, and says how many more", () => {
    const ss = build([]);
    const tech = ss.getTab("Tech") as FakeTab;
    for (let i = 0; i < 50; i++) {
      tech.appendRow(ITEM_HEADERS.map((h) => ({
        Item: `Extra long item name ${i} ${"quite wordy ".repeat(6)}`.trimEnd(), Brand: "Philips", Price: 1200, Status: "Available", "Available from": "Now", ID: `I-${300 + i}`, Quantity: 1,
      } as Record<string, unknown>)[h] as never ?? null));
      seed(ss, { id: i + 1, booking: i < 25 ? 1 : 2, item: `I-${300 + i}` });
    }
    const u = String(ask(ss, [T1, T2]).whatsappUrl);
    expect(u.length).toBeLessThan(2000);
    expect(() => decodeURIComponent(u.slice(u.indexOf("?text=") + 6))).not.toThrow(); // never cut mid-escape
    const t = textOf(u);
    expect(t).toContain(`/#/b/${T1}`);
    expect(t).toContain(`/#/b/${T2}`);
    const shown = t.split("\n").filter((l) => l.startsWith("• ")).length;
    const more = /…and (\d+) more/.exec(t);
    expect(more).not.toBeNull();
    expect(shown + Number(more![1])).toBe(50); // every bullet is either shown or counted
    expect(shown).toBeGreaterThan(0);
  });

  it("is null when nothing is reserved or waiting (only sold and backed-out items)", () => {
    const ss = build([{ id: 1, booking: 1, item: "I-0003", state: "sold", soldPrice: 5, soldAt: WHEN }, { id: 2, booking: 1, item: "I-0006", state: "released", endedAt: WHEN }]);
    expect(ask(ss, [T1])).toMatchObject({ ok: true, whatsappUrl: null });
  });

  it("is null when SELLER_WHATSAPP is missing or invalid, or SITE_URL is unusable, with the rest still answered", () => {
    for (const over of [{ sellerWhatsapp: undefined }, { sellerWhatsapp: "" }, { sellerWhatsapp: "12" }, { siteUrl: "" }, { siteUrl: "http://example.invalid" }]) {
      const r = ask(sheet(), [T1, T2], over);
      expect(r.whatsappUrl, JSON.stringify(over)).toBeNull();
      expect(list(r, "reserved")).toHaveLength(3);
    }
  });
});

describe("mine(): the combined backedOutUrl (Backed out)", () => {
  let r!: Out;
  let text = "";
  beforeEach(() => { r = ask(sheet(), [T1, T2]); text = textOf(r.backedOutUrl); });

  it("is a wa.me link to the seller naming every backed-out item across bookings, a book as 'Name by Author'", () => {
    const u = new URL(String(r.backedOutUrl));
    expect(`${u.origin}${u.pathname}`).toBe(`https://wa.me/${SELLER_DIGITS}`);
    expect(text).toContain("Buyer 1");
    expect(text).toMatch(/backed out/i);
    expect(text).toContain("Tiny Atlas by Author Q"); // Buyer 1's
    expect(text).toContain("Mystery box (Boxco)"); // Buyer 2's
  });

  it("leaves out held, waiting, sold and hand-released items", () => {
    for (const gone of ["Picture frame", "Echo Dot", "Yoga mat", "Lamp"]) expect(text, gone).not.toContain(gone);
  });

  it("carries no token, private link or buyer number, and the seller's number only in its host path", () => {
    const url = String(r.backedOutUrl);
    for (const secret of [T1, T2, "/#/b/", SITE, digits(1), digits(2), e164(1)]) expect(text, secret).not.toContain(secret);
    expect(url.replace(`https://wa.me/${SELLER_DIGITS}`, "")).not.toContain(SELLER_DIGITS);
  });

  it("is null when nothing was backed out, and when SELLER_WHATSAPP is missing or invalid", () => {
    expect(ask(build([{ id: 1, booking: 1, item: "I-0002" }]), [T1])).toMatchObject({ ok: true, backedOutUrl: null });
    for (const sellerWhatsapp of [undefined, "", "12", "not a number"]) expect(ask(sheet(), [T1, T2], { sellerWhatsapp }).backedOutUrl).toBeNull();
  });

  it("stays under 2,000 characters for a long list, keeping the first items and saying how many more", () => {
    const ss = build([]);
    const tech = ss.getTab("Tech") as FakeTab;
    for (let i = 0; i < 40; i++) {
      tech.appendRow(ITEM_HEADERS.map((h) => ({
        Item: `Extra long item name ${i} ${"quite wordy ".repeat(8)}`.trimEnd(), Brand: "Philips", Price: 1200, Status: "Available", "Available from": "Now", ID: `I-${400 + i}`, Quantity: 1,
      } as Record<string, unknown>)[h] as never ?? null));
      seed(ss, { id: i + 1, booking: i < 20 ? 1 : 2, item: `I-${400 + i}`, state: "released", endedAt: WHEN });
    }
    const u = String(ask(ss, [T1, T2]).backedOutUrl);
    expect(u.length).toBeLessThan(2000);
    expect(() => decodeURIComponent(u.slice(u.indexOf("?text=") + 6))).not.toThrow();
    expect(textOf(u)).toContain("Extra long item name 0 ");
    expect(textOf(u)).toMatch(/\d+ more/);
  });
});
