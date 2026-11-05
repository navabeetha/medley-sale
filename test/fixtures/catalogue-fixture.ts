// S-06 fixtures: a synthetic catalogue response (D-030 shape plus D-034 `contactUrl`) and a
// synthetic photo manifest (S-05 shape). Synthetic only: the number is the +91 90000 000xx kind.
import type { CatalogueItem } from "../../src/api/catalogue";

export const CONTACT_URL = "https://wa.me/919000000001";

export function item(over: Partial<CatalogueItem> & { id: string; name: string }): CatalogueItem {
  return {
    tab: "Tech",
    brand: null,
    author: null,
    category: null,
    price: 100,
    availableFrom: "Now",
    notes: null,
    link: null,
    quantity: 1,
    unitsLeft: 1,
    freeUnits: 1,
    waitingCount: 0,
    photos: 0,
    ...over,
  };
}

// Deliberately NOT in display order: a reserved item sits between two free ones.
export const ITEMS: CatalogueItem[] = [
  item({ id: "I-9001", name: "Test Kettle", brand: "Acme", price: 1200, availableFrom: "Now" }),
  item({
    id: "I-9002", name: "Test Lamp", brand: "Brightco", price: 450, tab: "Home Things",
    freeUnits: 0, unitsLeft: 1, waitingCount: 2, availableFrom: "2026-12-02",
  }),
  item({
    id: "I-9003", name: "Test Dumbbell Set", brand: "Liftco", price: 300, tab: "Gym & Sport",
    quantity: 3, unitsLeft: 3, freeUnits: 3,
  }),
  item({
    id: "I-9004", name: "Synthetic Novel", author: "A. Writer", tab: "Books", price: null,
    availableFrom: null,
  }),
];

export const MANIFEST: Record<string, { thumb: string; full: string; width: number; height: number; alt: string }[]> = {
  "I-9001": [
    { thumb: "I-9001-1-thumb.webp", full: "I-9001-1.webp", width: 800, height: 1000, alt: "Test Kettle, front view" },
    { thumb: "I-9001-2-thumb.webp", full: "I-9001-2.webp", width: 800, height: 1000, alt: "Test Kettle, base" },
  ],
  "I-9003": [
    { thumb: "I-9003-1-thumb.webp", full: "I-9003-1.webp", width: 1000, height: 700, alt: "Test Dumbbell Set" },
  ],
};

export const response = (items: CatalogueItem[] = ITEMS, contactUrl: string | null = CONTACT_URL) => ({
  items,
  contactUrl,
});
