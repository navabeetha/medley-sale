// S-09: the pure basket model (brief 6.3: 1 to 15 units in total; D-004: one claim per unit).
//
// DESIGNED INTERFACE (these tests are the spec for src/site/basket.ts; pure, no DOM, no storage):
//
//   export const MAX_BASKET_UNITS = 15                     // brief 6.3
//   export type Basket = readonly { id: string; units: number }[]
//        // Insertion order is kept. Every entry has an integer units >= 1. An id appears once.
//        // All functions return NEW baskets and never mutate their input.
//   export type Refusal = "basket-limit" | "item-limit" | "invalid"
//   export interface SetResult { basket: Basket; refused: Refusal | null }
//
//   emptyBasket(): Basket
//   totalUnits(b: Basket): number
//   unitsOf(b: Basket, id: string): number                 // 0 when absent
//   maxUnitsFor(item: CatalogueItem): number
//        // What one buyer may put in the basket for an item. freeUnits when there is a free unit,
//        // otherwise 1 (waiting list). CHOICE (smaller reading): an item with no free units can be
//        // joined for ONE unit only; the brief does not say more.
//   setUnits(b: Basket, id: string, units: number, maxForItem: number): SetResult
//        // units 0 removes the entry (never refused). Otherwise:
//        //   units not a finite integer, or negative  -> refused "invalid", basket unchanged
//        //   units > maxForItem                       -> refused "item-limit", basket unchanged
//        //   total after the change > 15              -> refused "basket-limit", basket unchanged
//        // Lowering units is never refused for the basket limit.
//   toggleItem(b: Basket, id: string, maxForItem: number): SetResult
//        // absent -> 1 unit; present (any units) -> removed. Refusals as setUnits.
//   pruneBasket(b: Basket, items: readonly CatalogueItem[]): Basket
//        // Drops entries whose id is not in `items` (silently: the smaller option), and lowers units
//        // to maxUnitsFor(item) when the item now has fewer. Order kept.
//   serializeBasket(b: Basket): string                     // for localStorage
//   parseBasket(raw: unknown): Basket
//        // Inverse of serializeBasket. NEVER throws: null, undefined, non-JSON text, wrong shapes
//        // -> emptyBasket(). Bad entries (non-string id, units not a positive integer, duplicate id)
//        // are skipped; entries are kept in order until adding the next would pass 15, which is skipped.
//   basketLabel(b: Basket): string                         // "Reserve (n)", n = totalUnits
import { describe, expect, it } from "vitest";
import {
  MAX_BASKET_UNITS, basketLabel, emptyBasket, maxUnitsFor, parseBasket, pruneBasket, serializeBasket,
  setUnits, toggleItem, totalUnits, unitsOf, type Basket,
} from "../../src/site/basket";
import { item } from "../fixtures/catalogue-fixture";

const b = (...e: [string, number][]): Basket => e.map(([id, units]) => ({ id, units }));

describe("limits and totals", () => {
  it("the basket limit is 15 units (brief 6.3)", () => {
    expect(MAX_BASKET_UNITS).toBe(15);
  });
  it("an empty basket has no units and the label counts zero", () => {
    expect(totalUnits(emptyBasket())).toBe(0);
    expect(unitsOf(emptyBasket(), "I-1")).toBe(0);
    expect(basketLabel(emptyBasket())).toBe("Reserve (0)");
  });
  it("totals units across items, not the number of items", () => {
    expect(totalUnits(b(["A", 3], ["B", 2]))).toBe(5);
    expect(basketLabel(b(["A", 3], ["B", 2]))).toBe("Reserve (5)");
    expect(unitsOf(b(["A", 3], ["B", 2]), "B")).toBe(2);
  });
});

describe("maxUnitsFor", () => {
  it("is the free units when some are free", () => {
    expect(maxUnitsFor(item({ id: "A", name: "A", quantity: 3, unitsLeft: 3, freeUnits: 3 }))).toBe(3);
    // 3 in stock but one is held by someone else: only 2 are free to take.
    expect(maxUnitsFor(item({ id: "A", name: "A", quantity: 3, unitsLeft: 3, freeUnits: 2 }))).toBe(2);
  });
  it("is 1 for a single item", () => {
    expect(maxUnitsFor(item({ id: "A", name: "A" }))).toBe(1);
  });
  it("is 1 when nothing is free (join the waiting list), even for a multi-unit item", () => {
    expect(maxUnitsFor(item({ id: "A", name: "A", freeUnits: 0, waitingCount: 4 }))).toBe(1);
    expect(maxUnitsFor(item({ id: "A", name: "A", quantity: 3, unitsLeft: 3, freeUnits: 0 }))).toBe(1);
  });
});

describe("setUnits", () => {
  it("adds a new item and sets units on an existing one, keeping order", () => {
    const one = setUnits(emptyBasket(), "A", 2, 5);
    expect(one).toEqual({ basket: b(["A", 2]), refused: null });
    const two = setUnits(one.basket, "B", 1, 1);
    const three = setUnits(two.basket, "A", 4, 5);
    expect(three.basket).toEqual(b(["A", 4], ["B", 1]));
    expect(three.refused).toBeNull();
  });
  it("removes the entry at 0 units, and 0 on an absent id is a harmless no-op", () => {
    expect(setUnits(b(["A", 2], ["B", 1]), "A", 0, 5)).toEqual({ basket: b(["B", 1]), refused: null });
    expect(setUnits(b(["B", 1]), "A", 0, 5)).toEqual({ basket: b(["B", 1]), refused: null });
  });
  it("refuses more than the item allows and leaves the basket unchanged", () => {
    const start = b(["A", 2]);
    expect(setUnits(start, "A", 4, 3)).toEqual({ basket: start, refused: "item-limit" });
  });
  it("allows exactly the item's maximum", () => {
    expect(setUnits(emptyBasket(), "A", 3, 3).refused).toBeNull();
  });
  it("refuses a 16th unit, whichever item it is for", () => {
    const full = b(["A", 10], ["B", 5]);
    expect(totalUnits(full)).toBe(15);
    expect(setUnits(full, "B", 6, 10)).toEqual({ basket: full, refused: "basket-limit" });
    expect(setUnits(full, "C", 1, 1)).toEqual({ basket: full, refused: "basket-limit" });
  });
  it("allows reaching exactly 15, and a change that keeps the total at 15", () => {
    const r = setUnits(b(["A", 10]), "B", 5, 10);
    expect(r.refused).toBeNull();
    expect(totalUnits(r.basket)).toBe(15);
    expect(setUnits(r.basket, "A", 10, 10).refused).toBeNull(); // no change in total
  });
  it("refuses a jump past 15 in one go, and does not partly apply it", () => {
    const start = b(["A", 14]);
    expect(setUnits(start, "B", 3, 5)).toEqual({ basket: start, refused: "basket-limit" });
  });
  it("lowering units is never refused, even from a full basket", () => {
    const r = setUnits(b(["A", 10], ["B", 5]), "A", 9, 10);
    expect(r.refused).toBeNull();
    expect(totalUnits(r.basket)).toBe(14);
  });
  it("refuses NaN, Infinity, fractions and negatives as invalid", () => {
    const start = b(["A", 1]);
    for (const bad of [Number.NaN, Infinity, -Infinity, 1.5, -1]) {
      expect(setUnits(start, "A", bad, 5)).toEqual({ basket: start, refused: "invalid" });
    }
  });
  it("does not mutate its input", () => {
    const start = b(["A", 1]);
    const snapshot = JSON.stringify(start);
    setUnits(start, "A", 2, 5);
    setUnits(start, "B", 1, 1);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
  it("is idempotent: the same call twice gives the same basket", () => {
    const once = setUnits(emptyBasket(), "A", 2, 5).basket;
    expect(setUnits(once, "A", 2, 5).basket).toEqual(once);
  });
});

describe("toggleItem", () => {
  it("adds one unit when absent and removes the item when present", () => {
    const added = toggleItem(emptyBasket(), "A", 1);
    expect(added).toEqual({ basket: b(["A", 1]), refused: null });
    expect(toggleItem(added.basket, "A", 1)).toEqual({ basket: emptyBasket(), refused: null });
  });
  it("removes a multi-unit entry entirely", () => {
    expect(toggleItem(b(["A", 3], ["B", 1]), "A", 3).basket).toEqual(b(["B", 1]));
  });
  it("refuses adding when the basket is full, and removing still works", () => {
    const full = b(["A", 15]);
    expect(toggleItem(full, "B", 1)).toEqual({ basket: full, refused: "basket-limit" });
    expect(toggleItem(full, "A", 15).basket).toEqual(emptyBasket());
  });
});

describe("pruneBasket (items that left the catalogue are dropped silently)", () => {
  const items = [
    item({ id: "A", name: "A", quantity: 3, unitsLeft: 3, freeUnits: 3 }),
    item({ id: "B", name: "B", freeUnits: 0, waitingCount: 1 }),
  ];
  it("drops entries whose item is gone, keeping the rest in order", () => {
    expect(pruneBasket(b(["X", 1], ["A", 2], ["Y", 4], ["B", 1]), items)).toEqual(b(["A", 2], ["B", 1]));
  });
  it("lowers units to what the item now allows", () => {
    expect(pruneBasket(b(["A", 3], ["B", 1]), [
      item({ id: "A", name: "A", quantity: 3, unitsLeft: 3, freeUnits: 1 }), items[1]!,
    ])).toEqual(b(["A", 1], ["B", 1]));
  });
  it("gives an empty basket when nothing matches, and leaves a matching basket as it was", () => {
    expect(pruneBasket(b(["X", 1]), items)).toEqual(emptyBasket());
    expect(pruneBasket(b(["A", 2]), items)).toEqual(b(["A", 2]));
    expect(pruneBasket(emptyBasket(), [])).toEqual(emptyBasket());
  });
  it("does not mutate its input", () => {
    const start = b(["X", 1], ["A", 2]);
    const snapshot = JSON.stringify(start);
    pruneBasket(start, items);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe("serializeBasket / parseBasket", () => {
  it("round-trips, including the empty basket", () => {
    const x = b(["I-9001", 1], ["I-9003", 2]);
    expect(parseBasket(serializeBasket(x))).toEqual(x);
    expect(parseBasket(serializeBasket(emptyBasket()))).toEqual(emptyBasket());
  });
  it("serializes to a string", () => {
    expect(typeof serializeBasket(b(["A", 1]))).toBe("string");
  });
  it("never throws and gives an empty basket for junk", () => {
    for (const junk of [null, undefined, "", "{not json", "null", "42", '"x"', "{}", '{"id":"A"}', 7, {}, [], true]) {
      expect(parseBasket(junk)).toEqual(emptyBasket());
    }
  });
  it("skips bad entries and keeps good ones", () => {
    const raw = JSON.stringify([
      { id: "A", units: 2 }, { id: 7, units: 1 }, { id: "B", units: 0 }, { id: "C", units: -1 },
      { id: "D", units: 1.5 }, { id: "E" }, null, "F", { id: "G", units: 1 }, { id: "A", units: 5 },
    ]);
    expect(parseBasket(raw)).toEqual(b(["A", 2], ["G", 1]));
  });
  it("never yields more than 15 units, even from a tampered value", () => {
    const parsed = parseBasket(JSON.stringify([{ id: "A", units: 10 }, { id: "B", units: 10 }, { id: "C", units: 5 }]));
    expect(totalUnits(parsed)).toBeLessThanOrEqual(MAX_BASKET_UNITS);
    expect(parsed).toEqual(b(["A", 10], ["C", 5])); // B would pass 15 so is skipped; C then fits
  });
});
