// G1 (the seller, 2026-11-07): the booking answer carries `backedOutUrl`, a wa.me link to the SELLER listing every item the
// buyer backed out of, shown on the booking page in the Ended section. Red step: written before the code.
//
// DESIGNED INTERFACE (src/api/booking.ts, and the same field on backOut's answer):
//   booking():  { ok: true, booking, whatsappUrl, backedOutUrl: string | null }
//   backOut():  { ok: true, booking, whatsappUrl, tellSellerUrl, backedOutUrl }   (backedOutUrl equals booking()'s afterwards)
//   backedOutUrl = `${https://wa.me/<seller digits>}?text=<encoded>` under 2,000 characters. The text is in the buyer's voice
//     (same wording as tellSellerUrl: "Hi! I'm <name>. I've backed out of ...") and names EVERY item of this booking the
//     buyer backed out of, worded with title() (brand in brackets, a book as "Name by Author"). No buyer number, no token,
//     no private link (D-011). null when nothing was backed out, or when SELLER_WHATSAPP is not a valid number.
//
// WHAT COUNTS AS "BACKED OUT" (PM: only the buyer's own back-outs, not units the seller released or sold to someone else).
// The sheet records a buyer back-out as State "released" AND an "Ended at" timestamp (backOut() writes both; nothing else in
// src/ writes Ended at). A claim the seller set to "released" by hand has no Ended at (see back-out.test.ts "released in the
// sheet"). So: released + non-blank Ended at = backed out by the buyer. A Claims tab with no Ended at column cannot tell, so
// nothing counts there. Units the seller sold to someone else leave this buyer's claim "active", so they never appear.
import { describe, expect, it } from "vitest";
import { backOut } from "../../src/api/back-out";
import { booking } from "../../src/api/booking";
import type { FakeTab } from "../fixtures/fake-sheet";
import {
  CLAIM_HEADERS, ITEM_HEADERS, NOW, SELLER_DIGITS, SELLER_PROPERTY, SITE, STAMP, build, digits, e164, harness, seed, tokenOf, type SeedClaim,
} from "../fixtures/queue-sheet";

const WHEN = "2026-11-05T09:00:00.000Z";
const deps = (over: Record<string, unknown> = {}) => ({ now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY, ...over }) as never;
const ask = (ss: ReturnType<typeof build>, token: string, over: Record<string, unknown> = {}) =>
  booking(ss, { token }, deps(over)) as unknown as { ok: boolean; backedOutUrl?: string | null };
const textOf = (url: string | null | undefined): string => new URL(String(url)).searchParams.get("text") ?? "";

// Buyer 1 backed out of the Echo Dot (Zorbo) and the book Tiny Atlas by Author Q, holds 1 frame, bought a yoga mat,
// and has a frame the seller released by hand (no Ended at).
const SEED: SeedClaim[] = [
  { id: 1, item: "I-0001", state: "released", endedAt: WHEN },
  { id: 2, item: "I-0006", booking: 1, state: "released", endedAt: WHEN },
  { id: 3, item: "I-0002", booking: 1 },
  { id: 4, item: "I-0003", booking: 1, state: "sold", soldPrice: 1000, soldAt: STAMP },
  { id: 5, item: "I-0004", booking: 1, state: "released" }, // released by the seller: no Ended at
  { id: 6, item: "I-0001", booking: 2 }, // another buyer holds the Echo Dot
];

describe("booking(): backedOutUrl", () => {
  it("is null when the buyer has backed out of nothing", () => {
    expect(ask(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0002", booking: 1 }]), tokenOf(1))).toMatchObject({ ok: true, backedOutUrl: null });
  });

  it("is a wa.me link to the seller whose text names every backed-out item with its brand, a book as 'Name by Author'", () => {
    const r = ask(build(SEED), tokenOf(1));
    const u = new URL(String(r.backedOutUrl));
    expect(`${u.origin}${u.pathname}`).toBe(`https://wa.me/${SELLER_DIGITS}`);
    const text = textOf(r.backedOutUrl);
    expect(text).toContain("Echo Dot (Zorbo)");
    expect(text).toContain("Tiny Atlas by Author Q");
    expect(text).toContain("Buyer 1"); // the buyer's voice, like tellSellerUrl
    expect(text).toMatch(/backed out/i);
  });

  it("leaves out items still held, bought, or released by the seller (no Ended at), and other buyers' items", () => {
    const text = textOf(ask(build(SEED), tokenOf(1)).backedOutUrl);
    expect(text).not.toContain("Picture frame"); // still held
    expect(text).not.toContain("Yoga mat"); // sold to this buyer
    expect(text).not.toContain("Lamp"); // the seller released it by hand
  });

  it("is null when the only released claims were released by the seller (no Ended at)", () => {
    const ss = build([{ id: 1, item: "I-0001", state: "released" }, { id: 2, item: "I-0002", booking: 1, state: "released" }]);
    expect(ask(ss, tokenOf(1))).toMatchObject({ ok: true, backedOutUrl: null });
  });

  it("is null for a buyer whose item was sold to someone else while they still wait", () => {
    const ss = build([{ id: 1, item: "I-0008", state: "sold", soldPrice: 5, soldAt: STAMP }, { id: 2, item: "I-0008" }]);
    expect(ask(ss, tokenOf(2))).toMatchObject({ ok: true, backedOutUrl: null });
  });

  it("is null when the Claims tab has no Ended at column, because a buyer back-out cannot then be told from the seller's", () => {
    const headers = CLAIM_HEADERS.filter((c) => c !== "Ended at");
    const ss = build([{ id: 1, item: "I-0001", state: "released" }], headers);
    expect(ask(ss, tokenOf(1))).toMatchObject({ ok: true, backedOutUrl: null });
  });

  it("does not list another buyer's back-outs", () => {
    const r = ask(build(SEED), tokenOf(2));
    expect(r).toMatchObject({ ok: true, backedOutUrl: null });
  });

  it("names an item once however many of its units the buyer backed out of", () => {
    const ss = build([
      { id: 1, item: "I-0002", state: "released", endedAt: WHEN },
      { id: 2, item: "I-0002", booking: 1, state: "released", endedAt: WHEN },
    ]);
    const text = textOf(ask(ss, tokenOf(1)).backedOutUrl);
    expect(text.split("Picture frame (Framex)").length - 1).toBe(1);
  });

  it("carries no buyer number, no token and no private link (D-011), and the seller's number only in its own host path", () => {
    const r = ask(build(SEED), tokenOf(1));
    const url = String(r.backedOutUrl);
    const text = textOf(url);
    for (const secret of [digits(1), e164(1), tokenOf(1), "/#/b/", SITE]) expect(text).not.toContain(secret);
    expect(url.replace(`https://wa.me/${SELLER_DIGITS}`, "")).not.toContain(SELLER_DIGITS);
  });

  it("is null when SELLER_WHATSAPP is missing or invalid, and the rest of the answer is still given", () => {
    for (const sellerWhatsapp of [undefined, "", "12", "not a number"]) {
      expect(ask(build(SEED), tokenOf(1), { sellerWhatsapp }), String(sellerWhatsapp)).toMatchObject({ ok: true, backedOutUrl: null });
    }
  });

  it("stays under 2,000 characters for a long list, keeps the first items, and says how many more", () => {
    const ss = build([]);
    const tech = ss.getTab("Tech") as FakeTab;
    const claims: SeedClaim[] = [];
    for (let i = 0; i < 40; i++) {
      const id = `I-${String(200 + i)}`;
      tech.appendRow(ITEM_HEADERS.map((h) => ({
        Item: `Extra long item name ${i} ${"quite wordy ".repeat(8)}`.trimEnd(), Brand: "Philips", Price: 1200, Status: "Available", "Available from": "Now", ID: id, Quantity: 1,
      } as Record<string, unknown>)[h] as never ?? null));
      claims.push({ id: i + 1, item: id, booking: 1, state: "released", endedAt: WHEN });
    }
    for (const c of claims) seed(ss, c);
    {
      const url = String(ask(ss, tokenOf(1)).backedOutUrl);
      expect(url.length).toBeLessThan(2000);
      expect(() => decodeURIComponent(url.slice(url.indexOf("?text=") + 6))).not.toThrow(); // never cut mid-escape
      expect(textOf(url)).toContain("Extra long item name 0 ");
      expect(textOf(url)).toMatch(/\d+ more/);
    }
  });
});

describe("booking(): the answer's keys", () => {
  it("now has exactly booking, ok, whatsappUrl and backedOutUrl", () => {
    expect(Object.keys(ask(build(SEED), tokenOf(1))).sort()).toEqual(["backedOutUrl", "booking", "ok", "whatsappUrl"]);
  });

  it("a not-found answer has no backedOutUrl", () => {
    expect(ask(build(SEED), "nope")).toEqual({ ok: false, error: "not-found" });
  });
});

describe("backOut(): carries the same backedOutUrl", () => {
  const LINE: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002", booking: 2 }];

  it("answers a backedOutUrl naming the item just backed out, equal to booking()'s afterwards", () => {
    const h = harness(build(LINE));
    const r = backOut(h.ss, { token: tokenOf(1), claimId: 1 }, h.deps as never) as unknown as { ok: boolean; backedOutUrl: string | null };
    expect(r.ok).toBe(true);
    expect(textOf(r.backedOutUrl)).toContain("Echo Dot (Zorbo)");
    expect(r.backedOutUrl).toBe(ask(h.ss, tokenOf(1)).backedOutUrl);
  });

  it("lists every earlier back-out too, not only the latest", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }, { id: 2, item: "I-0002", booking: 1 }, { id: 3, item: "I-0006", booking: 1 }]));
    backOut(h.ss, { token: tokenOf(1), claimId: 1 }, h.deps as never);
    const r = backOut(h.ss, { token: tokenOf(1), claimId: 3 }, h.deps as never) as unknown as { backedOutUrl: string };
    const text = textOf(r.backedOutUrl);
    expect(text).toContain("Echo Dot (Zorbo)");
    expect(text).toContain("Tiny Atlas by Author Q");
    expect(text).not.toContain("Picture frame");
  });

  it("a repeated request answers the same backedOutUrl", () => {
    const h = harness(build(LINE));
    const a = backOut(h.ss, { token: tokenOf(1), claimId: 1 }, h.deps as never) as unknown as { backedOutUrl: string };
    const b = backOut(h.ss, { token: tokenOf(1), claimId: 1 }, h.deps as never) as unknown as { backedOutUrl: string };
    expect(b.backedOutUrl).toBe(a.backedOutUrl);
  });

  it("is null in the answer when SELLER_WHATSAPP is invalid, and the back-out still happens", () => {
    const h = harness(build(LINE), { sellerWhatsapp: "12" });
    expect(backOut(h.ss, { token: tokenOf(1), claimId: 1 }, h.deps as never)).toMatchObject({ ok: true, backedOutUrl: null });
  });

  it("a refusal or not-found has no backedOutUrl", () => {
    const h = harness(build(LINE));
    expect(backOut(h.ss, { token: "nope", claimId: 1 }, h.deps as never)).not.toHaveProperty("backedOutUrl");
  });
});
