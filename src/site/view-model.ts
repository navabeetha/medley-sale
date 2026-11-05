// Pure view-model for the catalogue screen (S-06, D-034): turns API items into the strings the
// view shows. No DOM here, so it is unit-tested directly.
import type { CatalogueItem } from "../api/catalogue";

/** 1200 -> "₹1,200"; a blank price is "Ask". */
export function formatPrice(price: number | null): string {
  return price === null ? "Ask" : `₹${price.toLocaleString("en-US")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** D-006: "Now" or blank means anytime; a "YYYY-MM-DD" date reads "Pick up from 2 Dec". */
export function pickupLabel(availableFrom: string | null): string {
  const v = (availableFrom ?? "").trim();
  if (v === "" || v.toLowerCase() === "now") return "Pick up anytime";
  // Parsed by hand, not via Date: a plain calendar date must not shift with the time zone (D-030 rule 6).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `Pick up from ${Number(m[3])} ${month}` : `Pick up from ${v}`;
}

/** Brief 6.2. Counts FREE units (what a buyer can take), never "0 left" or "0 waiting". */
export function availabilityLabels(item: CatalogueItem): string[] {
  if (item.freeUnits <= 0) {
    return item.waitingCount > 0 ? ["Reserved", `${item.waitingCount} waiting`] : ["Reserved"];
  }
  return item.quantity > 1 ? [`${item.freeUnits} left`] : [];
}

/** Books read "name — author" (name first); everything else is just the name. */
export function displayTitle(item: CatalogueItem): string {
  return item.tab === "Books" && item.author ? `${item.name} — ${item.author}` : item.name;
}

/** The brand line for non-Books items. */
export function subtitle(item: CatalogueItem): string | null {
  return item.tab === "Books" ? null : item.brand || null;
}

/** Brief 6.2: items with a free unit first, then reserved ones; sheet order kept within each group. */
export function sortItems(items: CatalogueItem[]): CatalogueItem[] {
  const free = items.filter((i) => i.freeUnits > 0);
  return [...free, ...items.filter((i) => i.freeUnits <= 0)];
}

/** D-034: the server's contact URL plus a pre-filled message. Null when no contact URL is known. */
export function reserveUrl(contactUrl: string | null, itemName: string): string | null {
  if (!contactUrl) return null;
  return `${contactUrl}?text=${encodeURIComponent(`Hi! I'd like to reserve: ${itemName}`)}`;
}
