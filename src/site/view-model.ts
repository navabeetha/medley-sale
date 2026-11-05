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

/** True for a string, null, or (when `absent` is allowed) a missing value. */
function stringOrNull(v: unknown): boolean {
  return v === undefined || v === null || typeof v === "string";
}

/**
 * An item the view can safely render (F2, F7): string id and name, numeric freeUnits and unitsLeft,
 * price a finite number or null, the optional text fields a string or null/absent, photos a finite
 * number when present. Anything else is dropped rather than thrown on while drawing.
 */
export function isValidItem(v: unknown): v is CatalogueItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.name === "string"
    && typeof o.freeUnits === "number" && typeof o.unitsLeft === "number"
    && (o.price === null || (typeof o.price === "number" && Number.isFinite(o.price)))
    && ["brand", "author", "availableFrom", "notes", "category", "tab"].every((k) => stringOrNull(o[k]))
    && (o.photos === undefined || (typeof o.photos === "number" && Number.isFinite(o.photos)));
}

/** Keeps only the valid items, in order. Anything that is not an array gives an empty list. */
export function validItems(items: unknown): CatalogueItem[] {
  return Array.isArray(items) ? items.filter(isValidItem) : [];
}

/**
 * D-034: the server's contact URL plus a pre-filled message. Null when no contact URL is known.
 * Spaces are %20 (encodeURIComponent), never "+" (F9). Any `text` already on the contact URL is
 * dropped and its other parameters are kept as written, so there is exactly one `text`.
 */
export function reserveUrl(contactUrl: string | null, itemName: string): string | null {
  if (!contactUrl) return null;
  try {
    const url = new URL(contactUrl);
    const kept = url.search.slice(1).split("&").filter((p) => p !== "" && p.split("=")[0] !== "text");
    kept.push(`text=${encodeURIComponent(`Hi! I'd like to reserve: ${itemName}`)}`);
    url.search = kept.join("&");
    return url.toString();
  } catch {
    return null;
  }
}
