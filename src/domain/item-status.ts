// The Status words written back to item tabs (brief 4.1, 2.7). Pure. They stay inside the
// Available / Reserved / Sold words the migration and the status-mode catalogue already use,
// plus the brief's "2 left, 1 sold" shape for items with several units.

/**
 * @param unitsLeft units not yet sold (the queue engine's unitsLeft; the item must be available)
 * @param sold      units sold
 * @param holders   claims currently holding a unit
 */
export function itemStatus(unitsLeft: number, sold: number, holders: number): string {
  if (sold > 0) return unitsLeft > 0 ? `${unitsLeft} left, ${sold} sold` : "Sold";
  return holders >= unitsLeft ? "Reserved" : "Available";
}
