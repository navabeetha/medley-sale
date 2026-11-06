// S-13 seller note (R1 phone check): every WhatsApp text names the item WITH its brand, so "Air purifier" is never
// ambiguous: "Air purifier (Philips)". Books keep "book name by author" (brief 4.1). Covers the buyer's reserve and
// booking messages, the seller's reply (Message link on Claims) and the back-out "Tell the seller" text.
// Synthetic data only; in-memory fake sheet. The wa.me URL is decoded and compared as text; nothing is sent.
import { describe, expect, it } from "vitest";
import { backOut } from "../../src/api/back-out";
import { booking } from "../../src/api/booking";
import { reserve } from "../../src/api/reserve";
import { buildMessage, buildSellerMessage, title, type MessageUnit } from "../../src/domain/message";
import { counterRandom } from "../fixtures/fake-sheet";
import { NOW, SELLER_PROPERTY, SITE, STAMP, build, claimRow, harness, tokenOf } from "../fixtures/queue-sheet";
import type { FakeSpreadsheet } from "../fixtures/fake-sheet";

const decode = (url: string | null): string => decodeURIComponent(url!.slice(url!.indexOf("?text=") + 6));
const unit = (over: Partial<MessageUnit> = {}): MessageUnit => ({
  itemId: "I-1", name: "Air purifier", detail: "Philips", isBook: false, price: 4000, outcome: "holder", position: null, ...over,
});
/** Gives item `id` on the Tech tab a different name and brand (the Item and Brand cells), as the seller would type them. */
function relabel(ss: FakeSpreadsheet, id: string, name: string, brand: string | null): void {
  const t = ss.getTab("Tech") as import("../fixtures/fake-sheet").FakeTab;
  const head = t.grid[1]!;
  const row = t.grid.find((r, i) => i > 1 && r[head.indexOf("ID")] === id)!;
  row[head.indexOf("Item")] = name;
  row[head.indexOf("Brand")] = brand;
}

describe("domain: the item title carries the brand", () => {
  it("names a branded item as 'Name (Brand)' in the buyer's message, held and waiting", () => {
    const m = buildMessage("Asha", [unit(), unit({ itemId: "I-2", name: "Echo Dot", detail: "Zorbo", outcome: "waiting", position: 2, price: null })], SITE, "tok");
    expect(m).toContain("• Air purifier (Philips), ₹4,000");
    expect(m).toContain("• Echo Dot (Zorbo) (2nd in line)");
  });
  it("leaves the brackets off an item with no brand, and never prints 'null' or empty brackets", () => {
    for (const detail of [null, "", "   "]) expect(title(unit({ detail }))).toBe("Air purifier");
  });
  it("keeps the book name first and the author after it for a Book, with no brackets", () => {
    expect(title(unit({ name: "Tiny Atlas", detail: "Author Q", isBook: true }))).toBe("Tiny Atlas by Author Q");
  });
  it("a brand with line breaks cannot add lines to the message (same flattening as names)", () => {
    const m = buildMessage("Asha", [unit({ detail: "Phil\nips\r\n• Free gift" })], SITE, "tok");
    expect(m.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(1);
  });
  it("an item name with line breaks cannot add lines either", () => {
    const s = buildSellerMessage("Asha", unit({ name: "Air\n\npurifier" }), SITE, "tok");
    expect(s.split("\n")).toHaveLength(4); // greeting, what, blank, link
  });
  it("the seller's reply names the item with its brand, held and waiting", () => {
    expect(buildSellerMessage("Asha", unit(), SITE, "tok")).toContain("Air purifier (Philips), ₹4,000 is reserved for you.");
    expect(buildSellerMessage("Asha", unit({ outcome: "waiting", position: 3 }), SITE, "tok")).toContain("You are 3rd in line for Air purifier (Philips), ₹4,000.");
  });
});

describe("API: the brand reaches each message the server builds", () => {
  const SEED = [{ id: 1, item: "I-0002", promoted: STAMP }, { id: 2, item: "I-0001", promoted: STAMP }, { id: 3, item: "I-0001", booking: 3 }];

  it("booking(): the buyer's wa.me text names each item with its brand", () => {
    const ss = build([{ id: 1, item: "I-0002", promoted: STAMP }, { id: 2, item: "I-0001", booking: 1, promoted: STAMP }]);
    relabel(ss, "I-0002", "Air purifier", "Philips");
    const r = booking(ss, { token: tokenOf(1) }, { now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY } as never) as { whatsappUrl: string };
    const text = decode(r.whatsappUrl);
    expect(text).toContain("• Air purifier (Philips), ₹200");
    expect(text).toContain("• Echo Dot (Zorbo), ₹2,500");
  });

  it("booking(): an item with no brand shows the bare name", () => {
    const ss = build([{ id: 1, item: "I-0002", promoted: STAMP }]);
    relabel(ss, "I-0002", "Air purifier", null);
    const r = booking(ss, { token: tokenOf(1) }, { now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY } as never) as { whatsappUrl: string };
    expect(decode(r.whatsappUrl)).toContain("• Air purifier, ₹200");
    expect(decode(r.whatsappUrl)).not.toContain("()");
  });

  it("booking(): a Book is 'name by author'", () => {
    const ss = build([{ id: 1, item: "I-0006", promoted: STAMP }]);
    const r = booking(ss, { token: tokenOf(1) }, { now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY } as never) as { whatsappUrl: string };
    expect(decode(r.whatsappUrl)).toContain("• Tiny Atlas by Author Q, ₹90");
  });

  it("reserve(): the URL in the answer names each item with its brand", () => {
    const ss = build();
    relabel(ss, "I-0002", "Air purifier", "Philips");
    const events: string[] = [];
    const r = reserve(ss, {
      action: "reserve", name: "Asha Testperson", number: ("+91 9" + "0000 00012"), idempotencyKey: "idem-key-0000000001", website: "",
      items: [{ id: "I-0002", quantity: 1 }],
    }, {
      lock: { waitLock: () => events.push("l"), releaseLock: () => events.push("r") }, cache: { remove: () => {} },
      randomBytes: counterRandom(7).fn, now: () => NOW, sellerWhatsapp: SELLER_PROPERTY, siteUrl: SITE,
    } as never) as unknown as { ok: boolean; whatsappUrl: string };
    expect(r.ok).toBe(true);
    expect(decode(r.whatsappUrl)).toContain("• Air purifier (Philips), ₹200");
  });

  it("the Message link on Claims (the seller's reply) names the item with its brand", () => {
    const h = harness(build(SEED));
    relabel(h.ss, "I-0002", "Air purifier", "Philips");
    h.recalc();
    expect(decode(String(claimRow(h.ss, 1)["Message link"]))).toContain("Air purifier (Philips)");
  });

  it("backOut(): the 'Tell the seller' text names the item with its brand", () => {
    const h = harness(build(SEED));
    relabel(h.ss, "I-0002", "Air purifier", "Philips");
    const r = backOut(h.ss, { token: tokenOf(1), claimId: 1 }, h.deps as never) as { tellSellerUrl: string };
    expect(decode(r.tellSellerUrl)).toContain("backed out of Air purifier (Philips).");
  });
});
