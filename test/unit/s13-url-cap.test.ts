// S-13: the wa.me URL stays under 2,000 characters and keeps the private link (brief 6.3, T-13). The URL is built on the
// server, so the cap lives there: a long basket is cut to "…and N more" and the link line is never the part that goes.
//
// DESIGNED INTERFACE (src/domain/message.ts), the single place that builds the URL, used by reserve() and booking():
//   buildWhatsappUrl(base: string, buyerName: string, units: MessageUnit[], siteUrl: string, token: string): string
//     base is "https://wa.me/<digits>"; the result is `${base}?text=${encodeURIComponent(message)}` and its length is
//     under 2,000. When the full message fits it is exactly buildMessage's text. When it does not, whole bullets are dropped
//     from the END (held items first listed stay; the order of the rest is kept), a line "…and N more" says how many
//     bullets were dropped (N = bullets, the lines the buyer would have seen), and the "Change or back out" link line
//     is always kept intact as the last line. It is read through a namespace import so this file type-checks first.
// 2,000 is the limit in brief 6.3 ("under 2,000"), so the longest allowed URL is 1,999 characters.
import { describe, expect, it } from "vitest";
import { booking } from "../../src/api/booking";
import { reserve } from "../../src/api/reserve";
import * as message from "../../src/domain/message";
import type { MessageUnit } from "../../src/domain/message";
import { counterRandom, type FakeTab } from "../fixtures/fake-sheet";
import { ITEM_HEADERS, NOW, SELLER_DIGITS, SELLER_PROPERTY, SITE, STAMP, build, tokenOf } from "../fixtures/queue-sheet";

type BuildUrl = (base: string, name: string, units: MessageUnit[], siteUrl: string, token: string) => string;
const buildUrl = (...a: Parameters<BuildUrl>): string => ((message as unknown as Record<string, BuildUrl>)["buildWhatsappUrl"] as BuildUrl)(...a);
const BASE = `https://wa.me/${SELLER_DIGITS}`;
const TOKEN = "tok-" + "synthetic-" + "0001";
const LINK = `Change or back out: ${SITE}/#/b/${TOKEN}`;
const decode = (url: string): string => decodeURIComponent(url.slice(url.indexOf("?text=") + 6));
const lineOf = (n: number, len: number, extra = ""): string => `Long title number ${n} ${"word ".repeat(len)}${extra}`.slice(0, len);
const unit = (n: number, name: string, over: Partial<MessageUnit> = {}): MessageUnit => ({
  itemId: `I-${n}`, name, detail: "Philips", isBook: false, price: 1200, outcome: "holder", position: null, ...over,
});
const units = (count: number, len: number, over: Partial<MessageUnit> = {}): MessageUnit[] => Array.from({ length: count }, (_, i) => unit(i + 1, lineOf(i + 1, len), over));
const bullets = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("•"));

describe("buildWhatsappUrl: the cap", () => {
  it("leaves a short message exactly as buildMessage words it, with no 'more' line", () => {
    const u = units(2, 20);
    const url = buildUrl(BASE, "Asha", u, SITE, TOKEN);
    expect(url).toBe(`${BASE}?text=${encodeURIComponent(message.buildMessage("Asha", u, SITE, TOKEN))}`);
    expect(decode(url)).not.toContain("more");
  });

  it("keeps 15 units with long titles under 2,000 characters, with the private link as the last line", () => {
    const url = buildUrl(BASE, "Asha", units(15, 150), SITE, TOKEN);
    expect(url.length).toBeLessThan(2000);
    expect(decode(url).split("\n").at(-1)).toBe(LINK);
  });

  it("says '…and N more' where N is exactly the number of bullets dropped, keeping the first bullets in order", () => {
    const u = units(15, 150);
    const full = bullets(message.buildMessage("Asha", u, SITE, TOKEN));
    const text = decode(buildUrl(BASE, "Asha", u, SITE, TOKEN));
    const m = /…and (\d+) more/.exec(text);
    expect(m).not.toBeNull();
    const n = Number(m![1]);
    const shown = bullets(text);
    expect(n).toBeGreaterThan(0);
    expect(shown.length + n).toBe(full.length);
    expect(shown).toEqual(full.slice(0, shown.length));
  });

  it("counts waiting-list lines in N as well, and still keeps the link", () => {
    const u = [...units(8, 150), ...units(8, 150, { outcome: "waiting", position: 1 }).map((x, i) => ({ ...x, itemId: `W-${i}` }))];
    const url = buildUrl(BASE, "Asha", u, SITE, TOKEN);
    const text = decode(url);
    expect(url.length).toBeLessThan(2000);
    expect(text.split("\n").at(-1)).toBe(LINK);
    expect(bullets(text).length + Number(/…and (\d+) more/.exec(text)![1])).toBe(16);
  });

  it("is under the limit at the exact edge: the last length that fits is untouched, the first that does not is cut", () => {
    // Grow one title until the uncut URL reaches 2,000 characters, then look at both sides of that edge.
    const full = (len: number) => `${BASE}?text=${encodeURIComponent(message.buildMessage("Asha", units(3, len), SITE, TOKEN))}`;
    let len = 20;
    while (full(len).length < 2000) len++;
    const fits = full(len - 1);
    expect(fits.length).toBeLessThan(2000);
    expect(buildUrl(BASE, "Asha", units(3, len - 1), SITE, TOKEN)).toBe(fits);
    const cut = buildUrl(BASE, "Asha", units(3, len), SITE, TOKEN);
    expect(cut.length).toBeLessThan(2000);
    expect(decode(cut)).toMatch(/…and \d+ more/);
    expect(decode(cut).split("\n").at(-1)).toBe(LINK);
  });

  it("counts the encoded size: emoji and ₹ in titles (many bytes each) still fit, and the URL never ends mid-escape", () => {
    const u = Array.from({ length: 15 }, (_, i) => unit(i + 1, `🪴 Plant stand ₹ ${"café ".repeat(30)}${i}`, { price: 99999 }));
    const url = buildUrl(BASE, "Asha", u, SITE, TOKEN);
    expect(url.length).toBeLessThan(2000);
    expect(() => decodeURIComponent(url.slice(url.indexOf("?text=") + 6))).not.toThrow();
    expect(decode(url).split("\n").at(-1)).toBe(LINK);
  });

  it("copes with one unit whose title alone is longer than the limit: still under it, still with the link", () => {
    const url = buildUrl(BASE, "Asha", [unit(1, "x".repeat(5000))], SITE, TOKEN);
    expect(url.length).toBeLessThan(2000);
    expect(decode(url).split("\n").at(-1)).toBe(LINK);
  });

  it("is idempotent: the same input gives the same URL", () => {
    const u = units(15, 150);
    expect(buildUrl(BASE, "Asha", u, SITE, TOKEN)).toBe(buildUrl(BASE, "Asha", u, SITE, TOKEN));
  });
});

// ---- the handlers use it

/** The standard sheet plus 15 extra items with long names; returns their ids. */
function longSheet() {
  const ss = build();
  const tech = ss.getTab("Tech") as FakeTab;
  const ids = Array.from({ length: 15 }, (_, i) => `I-${String(100 + i)}`);
  ids.forEach((id, i) => {
    tech.appendRow(ITEM_HEADERS.map((h) => ({
      Item: `Extra long item name ${i} ${"quite wordy ".repeat(12)}`.trimEnd(), Brand: "Philips", Price: 1200, Status: "Available", "Available from": "Now", ID: id, Quantity: 1,
    } as Record<string, unknown>)[h] as never ?? null));
  });
  return { ss, ids };
}

describe("the handlers cap the URL they return", () => {
  it("reserve(): a 15-unit booking with long titles answers a URL under 2,000 characters that keeps the private link", () => {
    const { ss, ids } = longSheet();
    const r = reserve(ss, {
      action: "reserve", name: "Asha Testperson", number: ("+91 9" + "0000 00012"), idempotencyKey: "idem-key-0000000001", website: "",
      items: ids.map((id) => ({ id, quantity: 1 })),
    }, {
      lock: { waitLock: () => {}, releaseLock: () => {} }, cache: { remove: () => {} }, randomBytes: counterRandom(7).fn,
      now: () => NOW, sellerWhatsapp: SELLER_PROPERTY, siteUrl: SITE,
    } as never) as unknown as { ok: boolean; token: string; whatsappUrl: string };
    expect(r.ok).toBe(true);
    expect(r.whatsappUrl.length).toBeLessThan(2000);
    expect(decode(r.whatsappUrl)).toContain(`${SITE}/#/b/${r.token}`);
    expect(decode(r.whatsappUrl)).toMatch(/…and \d+ more/);
  });

  it("booking(): the same basket seen again answers a capped URL with the link", () => {
    const { ss, ids } = longSheet();
    (ss.getTab("Bookings") as FakeTab).appendRow([1, `'${tokenOf(1)}`, "Asha Testperson", `'+${["91", "90000", "00012"].join("")}`, STAMP, "'k", null]);
    ids.forEach((id, i) => {
      (ss.getTab("Claims") as FakeTab).appendRow([i + 1, 1, id, "x", "Asha Testperson", null, "active", STAMP, STAMP, null, null, null, null, null]);
    });
    const r = booking(ss, { token: tokenOf(1) }, { now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY } as never) as { ok: boolean; whatsappUrl: string };
    expect(r.ok).toBe(true);
    expect(r.whatsappUrl.length).toBeLessThan(2000);
    expect(decode(r.whatsappUrl)).toContain(`${SITE}/#/b/${tokenOf(1)}`);
    expect(decode(r.whatsappUrl)).toMatch(/…and \d+ more/);
  });
});
