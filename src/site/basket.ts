// S-09: the pure basket model (brief 6.3: 1 to 15 units in total; D-004: one claim per unit).
// No DOM and no storage here, so it is unit-tested directly (test/unit/basket.test.ts).
// Every function returns a NEW basket and never mutates its input.
import type { CatalogueItem } from "../api/catalogue";

/** Brief 6.3: one buyer reserves 1 to 15 units in one go. */
export const MAX_BASKET_UNITS = 15;

/** Insertion order is kept; each id appears once with an integer units >= 1. */
export type Basket = readonly { id: string; units: number }[];

/** Why a change was refused: the 15-unit total, the item's own maximum, or a nonsense number. */
export type Refusal = "basket-limit" | "item-limit" | "invalid";
export interface SetResult { basket: Basket; refused: Refusal | null }

export const emptyBasket = (): Basket => [];

export function totalUnits(b: Basket): number {
  return b.reduce((n, e) => n + e.units, 0);
}

export function unitsOf(b: Basket, id: string): number {
  return b.find((e) => e.id === id)?.units ?? 0;
}

/** "Reserve (n)", n counting units, not items (brief 7). */
export function basketLabel(b: Basket): string {
  return `Reserve (${totalUnits(b)})`;
}

/**
 * What one buyer may take of an item: its free units, or exactly ONE when none are free (join the
 * waiting list). The brief says nothing more about waiting-list quantities, so this is the smaller reading.
 */
export function maxUnitsFor(item: CatalogueItem): number {
  return item.freeUnits > 0 ? item.freeUnits : 1;
}

/** Sets an item's units (0 removes it). A refused change returns the basket untouched. */
export function setUnits(b: Basket, id: string, units: number, maxForItem: number): SetResult {
  const refuse = (refused: Refusal): SetResult => ({ basket: b, refused });
  if (!Number.isInteger(units) || units < 0) return refuse("invalid");
  const rest = b.filter((e) => e.id !== id);
  if (units === 0) return { basket: rest, refused: null };
  if (units > maxForItem) return refuse("item-limit");
  if (totalUnits(rest) + units > MAX_BASKET_UNITS) return refuse("basket-limit");
  // Replace in place so an existing item keeps its position; a new one goes on the end.
  const basket = b.some((e) => e.id === id) ? b.map((e) => (e.id === id ? { id, units } : e)) : [...rest, { id, units }];
  return { basket, refused: null };
}

/** The Add button: absent -> one unit, present (any units) -> removed. */
export function toggleItem(b: Basket, id: string, maxForItem: number): SetResult {
  return setUnits(b, id, unitsOf(b, id) > 0 ? 0 : 1, maxForItem);
}

/** Drops entries whose item has left the catalogue (silently) and lowers units to what is now free. */
export function pruneBasket(b: Basket, items: readonly CatalogueItem[]): Basket {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: { id: string; units: number }[] = [];
  for (const e of b) {
    const item = byId.get(e.id);
    if (item) out.push({ id: e.id, units: Math.min(e.units, maxUnitsFor(item)) });
  }
  return out;
}

export function serializeBasket(b: Basket): string {
  return JSON.stringify(b);
}

/** Inverse of serializeBasket. Never throws: junk gives an empty basket, bad entries are skipped. */
export function parseBasket(raw: unknown): Basket {
  if (typeof raw !== "string") return emptyBasket();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyBasket();
  }
  if (!Array.isArray(data)) return emptyBasket();
  const out: { id: string; units: number }[] = [];
  let total = 0;
  for (const e of data as unknown[]) {
    const o = e as { id?: unknown; units?: unknown } | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string") continue;
    const units = o.units;
    if (typeof units !== "number" || !Number.isInteger(units) || units < 1) continue;
    if (out.some((x) => x.id === o.id) || total + units > MAX_BASKET_UNITS) continue; // tampered storage can't pass 15
    out.push({ id: o.id, units });
    total += units;
  }
  return out;
}
