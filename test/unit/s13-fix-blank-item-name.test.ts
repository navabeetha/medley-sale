// S-13 fix (QA F4): an item whose name is only whitespace gave the bullet "• , ₹1,200". It reads "Item" instead.
// Spec says whitespace-only; an empty name is assumed to be the same case (flagged in the report). Synthetic data only.
import { describe, expect, it } from "vitest";
import { buildMessage, buildSellerMessage, buildWhatsappUrl, title, type MessageUnit } from "../../src/domain/message";
import { SELLER_DIGITS, SITE } from "../fixtures/queue-sheet";

const TOKEN = "tok-" + "synthetic-" + "0001";
const unit = (over: Partial<MessageUnit> = {}): MessageUnit => ({ itemId: "I-1", name: " ", detail: null, isBook: false, price: 1200, outcome: "holder", position: null, ...over });
const decode = (url: string): string => decodeURIComponent(url.slice(url.indexOf("?text=") + 6));

describe("a blank item name shows as 'Item'", () => {
  it.each([["a space", " "], ["tabs, newlines and a non-breaking space", "\t\n  "], ["an empty string", ""]])("title() of a name that is %s is 'Item'", (_l, name) => {
    expect(title(unit({ name }))).toBe("Item");
  });

  it("the reserved bullet reads '• Item, ₹1,200', not '• , ₹1,200'", () => {
    const lines = buildMessage("Asha", [unit()], SITE, TOKEN).split("\n");
    expect(lines).toContain("• Item, ₹1,200");
    expect(lines).not.toContain("• , ₹1,200");
  });

  it("the waiting bullet reads '• Item, ₹1,200 (2nd in line)'", () => {
    expect(buildMessage("Asha", [unit({ outcome: "waiting", position: 2 })], SITE, TOKEN).split("\n")).toContain("• Item, ₹1,200 (2nd in line)");
  });

  it("the same in the capped URL text, and in the seller's message", () => {
    expect(decode(buildWhatsappUrl(`https://wa.me/${SELLER_DIGITS}`, "Asha", [unit()], SITE, TOKEN))).toContain("• Item, ₹1,200");
    expect(buildSellerMessage("Asha", unit(), SITE, TOKEN)).toContain("Item, ₹1,200 is reserved for you.");
  });

  it("a blank name with a brand or author still shows 'Item' with it", () => {
    expect(title(unit({ detail: "Philips" }))).toBe("Item (Philips)");
    expect(title(unit({ isBook: true, detail: "Some Author" }))).toBe("Item by Some Author");
  });

  it("a real name is untouched", () => {
    expect(title(unit({ name: "  Echo   Dot " }))).toBe("Echo Dot");
  });
});
