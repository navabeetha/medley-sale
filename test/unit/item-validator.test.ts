// S-06 F2: the pure item validator used on cache reads and API answers.
import { describe, expect, it } from "vitest";
import { isValidItem, validItems } from "../../src/site/view-model";
import { item } from "../fixtures/catalogue-fixture";

describe("isValidItem", () => {
  it("accepts a full item", () => expect(isValidItem(item({ id: "I-1", name: "x" }))).toBe(true));
  it("accepts the minimum: string id and name, numeric freeUnits and unitsLeft", () =>
    expect(isValidItem({ id: "I-1", name: "x", freeUnits: 0, unitsLeft: 0 })).toBe(true));
  it.each([null, undefined, 5, "text", [], {}])("rejects %j", (v) => expect(isValidItem(v)).toBe(false));
  it.each([
    ["id", 42], ["id", undefined], ["name", 5], ["name", undefined],
    ["freeUnits", "1"], ["freeUnits", undefined], ["unitsLeft", "1"], ["unitsLeft", undefined],
  ])("rejects an item whose %s is %j", (k, v) =>
    expect(isValidItem({ ...item({ id: "I-1", name: "x" }), [k]: v })).toBe(false));
});

describe("validItems", () => {
  it("drops invalid items and keeps order", () => {
    const a = item({ id: "A", name: "a" });
    const b = item({ id: "B", name: "b" });
    expect(validItems([a, null, { id: "z" }, b])).toEqual([a, b]);
  });
  it("gives an empty list for a non-array", () => expect(validItems("nope")).toEqual([]));
});
