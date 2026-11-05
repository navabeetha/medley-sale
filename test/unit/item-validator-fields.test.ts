// S-06 F7: isValidItem must check every field the catalogue view reads, not only id, name,
// freeUnits and unitsLeft. An item that passes today but has a wrongly typed field makes the
// view throw (for example formatPrice(undefined)), which blanks the whole list. PM rules:
//  - price is a finite number or null (missing, a string, NaN, Infinity: invalid)
//  - brand, author, availableFrom, notes, category, tab: a string, or null, or absent
//  - photos: a number when present
// A bad item is dropped; it never throws. Synthetic data only.
import { describe, expect, it } from "vitest";
import { isValidItem, validItems } from "../../src/site/view-model";
import { item } from "../fixtures/catalogue-fixture";

const base = () => item({ id: "I-1", name: "x" });
/** The fixture item with one field overridden (or deleted, when the value is the marker below). */
const MISSING = Symbol("missing");
function with_(key: string, value: unknown): unknown {
  const o: Record<string, unknown> = { ...base() };
  if (value === MISSING) delete o[key];
  else o[key] = value;
  return o;
}

describe("isValidItem: price is a finite number or null", () => {
  it.each([0, 1200, 0.5, -1, null])("accepts price %j", (v) => expect(isValidItem(with_("price", v))).toBe(true));
  it.each([
    ["missing", MISSING], ["undefined", undefined], ["a string", "100"], ["NaN", NaN],
    ["Infinity", Infinity], ["-Infinity", -Infinity], ["an object", {}], ["a boolean", true],
  ])("rejects price that is %s", (_n, v) => expect(isValidItem(with_("price", v))).toBe(false));
});

describe("isValidItem: optional string fields are a string, null or absent", () => {
  const fields = ["brand", "author", "availableFrom", "notes", "category", "tab"];
  describe.each(fields)("%s", (f) => {
    it.each([["a string", "text"], ["an empty string", ""], ["null", null], ["absent", MISSING]])(
      "accepts %s", (_n, v) => expect(isValidItem(with_(f, v))).toBe(true));
    it.each([["a number", 5], ["a boolean", false], ["an object", {}], ["an array", []]])(
      "rejects %s", (_n, v) => expect(isValidItem(with_(f, v))).toBe(false));
  });
});

describe("isValidItem: photos is a number when present", () => {
  it.each([0, 2])("accepts photos %j", (v) => expect(isValidItem(with_("photos", v))).toBe(true));
  it("accepts photos absent", () => expect(isValidItem(with_("photos", MISSING))).toBe(true));
  it.each([["a string", "2"], ["null", null], ["NaN", NaN], ["an object", {}]])(
    "rejects photos that is %s", (_n, v) => expect(isValidItem(with_("photos", v))).toBe(false));
});

describe("validItems with field-level bad items", () => {
  it("drops items with a bad price or a bad optional field and keeps the rest in order, without throwing", () => {
    const a = item({ id: "A", name: "a" });
    const b = item({ id: "B", name: "b", price: null });
    const noPrice = with_("price", MISSING);
    const strPrice = with_("price", "9");
    const nanPrice = with_("price", NaN);
    const numBrand = with_("brand", 7);
    const strPhotos = with_("photos", "1");
    expect(() => validItems([a, noPrice, strPrice, nanPrice, numBrand, strPhotos, b])).not.toThrow();
    expect(validItems([a, noPrice, strPrice, nanPrice, numBrand, strPhotos, b])).toEqual([a, b]);
  });
});
