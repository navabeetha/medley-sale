// S-13 fix (QA F3): the URL cap drops bullets from the end, and the "no heading without a bullet" loop in compose also popped
// the greeting "Hi! I'm <name>." when even the first bullet was too long, so the seller could not tell who was writing.
// The greeting is never dropped by the cap. Synthetic data only.
import { describe, expect, it } from "vitest";
import { buildWhatsappUrl, type MessageUnit } from "../../src/domain/message";
import { SELLER_DIGITS, SITE } from "../fixtures/queue-sheet";

const BASE = `https://wa.me/${SELLER_DIGITS}`;
const TOKEN = "tok-" + "synthetic-" + "0001";
const LINK = `Change or back out: ${SITE}/#/b/${TOKEN}`;
const decode = (url: string): string => decodeURIComponent(url.slice(url.indexOf("?text=") + 6));
const unit = (n: number, name: string, over: Partial<MessageUnit> = {}): MessageUnit => ({
  itemId: `I-${n}`, name, detail: null, isBook: false, price: 1200, outcome: "holder", position: null, ...over,
});
const GREETING = "Hi! I'm Asha.";

describe("the greeting survives the URL cap", () => {
  it("a single bullet too long to fit: the text still starts with the greeting and ends with the link", () => {
    const url = buildWhatsappUrl(BASE, "Asha", [unit(1, "x".repeat(5000))], SITE, TOKEN);
    const lines = decode(url).split("\n");
    expect(url.length).toBeLessThan(2000);
    expect(lines[0]).toBe(GREETING);
    expect(lines.at(-1)).toBe(LINK);
    expect(lines.join("\n")).toMatch(/…and 1 more/);
  });

  it("the QA repro: one Devanagari title of about 200 characters (encoded, over the limit) keeps the greeting", () => {
    const url = buildWhatsappUrl(BASE, "Asha", [unit(1, "पौधा ".repeat(50))], SITE, TOKEN);
    expect(url.length).toBeLessThan(2000);
    expect(decode(url).split("\n")[0]).toBe(GREETING);
  });

  it("every bullet too long (held and waiting): the greeting stays, the headings with no bullet go, N counts them all", () => {
    const u = [unit(1, "x".repeat(3000)), unit(2, "y".repeat(3000), { outcome: "waiting", position: 1 })];
    const text = decode(buildWhatsappUrl(BASE, "Asha", u, SITE, TOKEN));
    expect(text.split("\n")[0]).toBe(GREETING);
    expect(text).toContain("…and 2 more");
    expect(text).not.toContain("Reserved for me:");
    expect(text).not.toContain("On the waiting list:");
    expect(text.split("\n").at(-1)).toBe(LINK);
  });

  it("a long buyer name does not matter: the greeting line is whatever the name makes it, still first", () => {
    const text = decode(buildWhatsappUrl(BASE, "Asha Testperson", [unit(1, "x".repeat(5000))], SITE, TOKEN));
    expect(text.split("\n")[0]).toBe("Hi! I'm Asha Testperson.");
  });

  it("control: when bullets fit nothing changes, the greeting is first and no 'more' line appears", () => {
    const text = decode(buildWhatsappUrl(BASE, "Asha", [unit(1, "Lamp")], SITE, TOKEN));
    expect(text.split("\n")[0]).toBe(GREETING);
    expect(text).not.toContain("more");
  });
});
