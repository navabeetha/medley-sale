// S-15 QA F5: the seller's reply to one buyer (buildSellerMessage, src/domain/message.ts), tested directly.
// These pin behaviour that already works (QA found surviving mutants, not a bug), so they pass on the current code.
// Synthetic names and a reserved example domain only.
import { describe, expect, it } from "vitest";
import { buildSellerMessage, type MessageUnit } from "../../src/domain/message";

const SITE = "https://example.invalid/medley-sale";
const TOKEN = "tok-0001";
const LINK_LINE = `Change or back out: ${SITE}/#/b/${TOKEN}`;

const unit = (over: Partial<MessageUnit> = {}): MessageUnit => ({
  itemId: "I-0001", name: "Echo Dot", detail: "Zorbo", isBook: false, price: 2500, outcome: "holder", position: null, ...over,
});
const lines = (name: string, u: MessageUnit, site = SITE) => buildSellerMessage(name, u, site, TOKEN).split("\n");

describe("buildSellerMessage: a holder", () => {
  it("greets by name, says the item is reserved for them, and ends with their private link", () => {
    // Hand-built from the brief 2.7 shape: greeting, one sentence, blank line, link.
    expect(lines("Asha Testperson", unit())).toEqual([
      "Hi Asha Testperson!",
      "Echo Dot (Zorbo), ₹2,500 is reserved for you.",
      "",
      LINK_LINE,
    ]);
  });

  it("puts the brand in parentheses after the name, and omits them when there is no brand", () => {
    expect(lines("Asha", unit({ detail: "Zorbo" }))[1]).toContain("Echo Dot (Zorbo)");
    expect(lines("Asha", unit({ detail: null }))[1]).toBe("Echo Dot, ₹2,500 is reserved for you.");
    expect(lines("Asha", unit({ detail: "" }))[1]).toBe("Echo Dot, ₹2,500 is reserved for you.");
  });

  it("words a book as 'Name by Author', without parentheses", () => {
    const l = lines("Asha", unit({ name: "Tiny Atlas", detail: "Author Q", isBook: true, price: 90 }));
    expect(l[1]).toBe("Tiny Atlas by Author Q, ₹90 is reserved for you.");
  });

  it("leaves the price out when the item has none", () => {
    expect(lines("Asha", unit({ price: null }))[1]).toBe("Echo Dot (Zorbo) is reserved for you.");
  });

  it("groups thousands with commas and keeps a fraction", () => {
    expect(lines("Asha", unit({ price: 1234567 }))[1]).toContain("₹1,234,567");
    expect(lines("Asha", unit({ price: 999 }))[1]).toContain("₹999 is");
    expect(lines("Asha", unit({ price: 99.5 }))[1]).toContain("₹99.5");
  });
});

describe("buildSellerMessage: a waiter", () => {
  it("gives their place in line and never says they hold the item", () => {
    const l = lines("Asha", unit({ outcome: "waiting", position: 2 }));
    expect(l[1]).toBe("You are 2nd in line for Echo Dot (Zorbo), ₹2,500.");
    expect(l.join("\n")).not.toContain("reserved for you");
  });

  it("uses English ordinals, including the teens", () => {
    const ord = (n: number) => /You are (\S+) in line/.exec(lines("A", unit({ outcome: "waiting", position: n }))[1]!)![1];
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ord)).toEqual(
      ["1st", "2nd", "3rd", "4th", "10th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th"],
    );
  });

  it("treats a missing position as first in line", () => {
    expect(lines("Asha", unit({ outcome: "waiting", position: null }))[1]).toContain("You are 1st in line");
  });

  it("words a waiting book and an unpriced item the same way as a holder's", () => {
    expect(lines("Asha", unit({ outcome: "waiting", position: 1, name: "Tiny Atlas", detail: "Author Q", isBook: true, price: null }))[1])
      .toBe("You are 1st in line for Tiny Atlas by Author Q.");
  });
});

describe("buildSellerMessage: the greeting and the link line", () => {
  it("flattens line breaks and runs of spaces in the name, so a name cannot add lines to the chat", () => {
    const l = lines("Asha\nTest\r\n\n  Person", unit());
    expect(l[0]).toBe("Hi Asha Test Person!");
    expect(l).toHaveLength(4);
  });

  it("keeps the name as typed otherwise (no escaping, no guard apostrophe)", () => {
    expect(lines("=Asha & Co", unit())[0]).toBe("Hi =Asha & Co!");
  });

  it("ends with the link line, whichever role", () => {
    for (const u of [unit(), unit({ outcome: "waiting", position: 3 })]) {
      const l = lines("Asha", u);
      expect(l[l.length - 1]).toBe(LINK_LINE);
      expect(l[l.length - 2]).toBe("");
    }
  });

  it("tolerates trailing slashes on the site URL, without doubling them", () => {
    expect(lines("Asha", unit(), `${SITE}///`).at(-1)).toBe(LINK_LINE);
  });

  it("contains the token exactly once", () => {
    expect(buildSellerMessage("Asha", unit(), SITE, TOKEN).split(TOKEN)).toHaveLength(2);
  });
});
