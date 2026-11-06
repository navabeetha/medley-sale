// S-13 fix (QA F2): a lone UTF-16 surrogate in the buyer name, item name or brand made encodeURIComponent throw a URIError,
// after reserve() had already saved the booking, so the buyer got "unavailable" and no token. flatten() must turn each
// unpaired surrogate into U+FFFD so reserve, booking and buildSellerMessage never throw. Synthetic data; in-memory fake sheet.
import { describe, expect, it } from "vitest";
import { booking } from "../../src/api/booking";
import { reserve } from "../../src/api/reserve";
import { buildMessage, buildSellerMessage, buildWhatsappUrl, title, type MessageUnit } from "../../src/domain/message";
import { counterRandom, type FakeTab } from "../fixtures/fake-sheet";
import { NOW, SELLER_DIGITS, SELLER_PROPERTY, SITE, STAMP, build, tokenOf } from "../fixtures/queue-sheet";

const LONE_HIGH = String.fromCharCode(0xd800), LONE_LOW = String.fromCharCode(0xdc00), FFFD = "�";
const BAD_NAME = `As${LONE_HIGH}ha`; // the QA repro
const BASE = `https://wa.me/${SELLER_DIGITS}`;
const TOKEN = "tok-" + "synthetic-" + "0001";
const unit = (over: Partial<MessageUnit> = {}): MessageUnit => ({ itemId: "I-1", name: "Lamp", detail: "Philips", isBook: false, price: 1200, outcome: "holder", position: null, ...over });
const decode = (url: string): string => decodeURIComponent(url.slice(url.indexOf("?text=") + 6));

describe("message text: a lone surrogate becomes U+FFFD and nothing throws", () => {
  it.each([
    ["a lone high surrogate", LONE_HIGH],
    ["a lone low surrogate", LONE_LOW],
    ["a low surrogate before a high one (reversed pair)", LONE_LOW + LONE_HIGH],
  ])("buyer name with %s: buildWhatsappUrl and buildMessage and buildSellerMessage succeed", (_l, bad) => {
    const name = `As${bad}ha`;
    const expected = `As${FFFD.repeat(bad.length)}ha`; // one U+FFFD per unpaired code unit
    expect(() => buildWhatsappUrl(BASE, name, [unit()], SITE, TOKEN)).not.toThrow();
    expect(decode(buildWhatsappUrl(BASE, name, [unit()], SITE, TOKEN))).toContain(`Hi! I'm ${expected}.`);
    expect(buildMessage(name, [unit()], SITE, TOKEN)).toContain(`I'm ${expected}.`);
    expect(buildSellerMessage(name, unit(), SITE, TOKEN)).toContain(`Hi ${expected}!`);
  });

  it("item name with a lone surrogate: title, the URL and the seller message succeed", () => {
    const u = unit({ name: `La${LONE_HIGH}mp` });
    expect(title(u)).toBe(`La${FFFD}mp (Philips)`);
    expect(decode(buildWhatsappUrl(BASE, "Asha", [u], SITE, TOKEN))).toContain(`La${FFFD}mp (Philips)`);
    expect(buildSellerMessage("Asha", u, SITE, TOKEN)).toContain(`La${FFFD}mp (Philips)`);
  });

  it("brand with a lone surrogate, on a book (author) as well as on other items", () => {
    expect(title(unit({ detail: `Phi${LONE_LOW}lips` }))).toBe(`Lamp (Phi${FFFD}lips)`);
    expect(title(unit({ isBook: true, name: "Atlas", detail: `Au${LONE_HIGH}thor` }))).toBe(`Atlas by Au${FFFD}thor`);
    expect(() => buildWhatsappUrl(BASE, "Asha", [unit({ detail: `Phi${LONE_LOW}lips` })], SITE, TOKEN)).not.toThrow();
  });

  it("a valid surrogate pair (an emoji) is kept as it is", () => {
    expect(title(unit({ name: "Plant 🪴" }))).toBe("Plant 🪴 (Philips)");
  });

  it("the output is well-formed: encodeURIComponent accepts every text built from bad input", () => {
    const bad = `${LONE_HIGH}${LONE_LOW}x${LONE_HIGH}`;
    const u = unit({ name: bad, detail: bad });
    expect(() => encodeURIComponent(buildMessage(bad, [u], SITE, TOKEN))).not.toThrow();
    expect(() => encodeURIComponent(buildSellerMessage(bad, u, SITE, TOKEN))).not.toThrow();
  });
});

describe("handlers: a lone surrogate in the buyer name does not lose the buyer's token", () => {
  const deps = () => ({
    lock: { waitLock: () => {}, releaseLock: () => {} }, cache: { remove: () => {} }, randomBytes: counterRandom(7).fn,
    now: () => NOW, sellerWhatsapp: SELLER_PROPERTY, siteUrl: SITE,
  });
  const request = (name: string) => ({
    action: "reserve", name, number: "+91 9" + "0000 00012", idempotencyKey: "idem-key-0000000001", website: "",
    items: [{ id: "I-0001", quantity: 1 }],
  });

  it("reserve() with name 'As<lone high surrogate>ha' returns ok with a token and a URL", () => {
    const ss = build();
    const r = reserve(ss, request(BAD_NAME), deps() as never) as unknown as { ok: boolean; token?: string; whatsappUrl?: string };
    expect(r.ok).toBe(true);
    expect(typeof r.token).toBe("string");
    expect(r.token).not.toBe("");
    expect(decode(r.whatsappUrl!)).toContain(`Hi! I'm As${FFFD}ha.`);
  });

  it("a retry with the same key answers ok with the same token", () => {
    const ss = build();
    const a = reserve(ss, request(BAD_NAME), deps() as never) as unknown as { ok: boolean; token: string };
    const b = reserve(ss, request(BAD_NAME), deps() as never) as unknown as { ok: boolean; token: string };
    expect(b.ok).toBe(true);
    expect(b.token).toBe(a.token);
  });

  it("booking() for a booking saved under that name answers ok with a URL", () => {
    const ss = build();
    (ss.getTab("Bookings") as FakeTab).appendRow([1, `'${tokenOf(1)}`, BAD_NAME, `'+${["91", "90000", "00012"].join("")}`, STAMP, "'k", null]);
    (ss.getTab("Claims") as FakeTab).appendRow([1, 1, "I-0001", "x", BAD_NAME, null, "active", STAMP, STAMP, null, null, null, null, null]);
    const r = booking(ss, { token: tokenOf(1) }, { now: () => NOW, siteUrl: SITE, sellerWhatsapp: SELLER_PROPERTY } as never) as { ok: boolean; whatsappUrl: string };
    expect(r.ok).toBe(true);
    expect(decode(r.whatsappUrl)).toContain(`Hi! I'm As${FFFD}ha.`);
  });
});
