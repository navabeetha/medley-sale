// S-06 (as amended by D-034): pure view-model for the catalogue screen.
//
// DESIGNED INTERFACE (these tests are the spec):
//
//   src/site/config.ts       export const API_URL: string      // public Apps Script /exec URL (brief 4.2)
//   src/site/view-model.ts   (all pure, no DOM)
//     formatPrice(price: number | null): string               // null -> "Ask"; 1200 -> "₹1,200"
//     pickupLabel(availableFrom: string | null): string       // D-006
//     availabilityLabels(item): string[]                      // brief 6.2, [] when nothing to say
//     displayTitle(item): string                              // Books: "name — author"
//     subtitle(item): string | null                           // brand for non-Books, else null
//     sortItems(items): CatalogueItem[]                       // 6.2: free first, then reserved; stable; no mutation
//     reserveUrl(contactUrl: string | null, itemName: string): string | null   // D-034 item 2/4
import { describe, expect, it } from "vitest";
import { API_URL } from "../../src/site/config";
import {
  availabilityLabels, displayTitle, formatPrice, pickupLabel, reserveUrl, sortItems, subtitle,
} from "../../src/site/view-model";
import { CONTACT_URL, item } from "../fixtures/catalogue-fixture";

describe("config", () => {
  it("API_URL is an https Apps Script URL on a host the CSP already allows, with no query string", () => {
    const u = new URL(API_URL);
    expect(u.protocol).toBe("https:");
    expect(u.hostname).toBe("script.google.com"); // CSP connect-src in public/index.html
    expect(u.search).toBe("");
  });
});

describe("formatPrice", () => {
  it("shows Ask when the price is blank", () => {
    expect(formatPrice(null)).toBe("Ask");
  });
  it("shows rupees with a thousands separator", () => {
    expect(formatPrice(1200)).toBe("₹1,200");
    expect(formatPrice(450)).toBe("₹450");
  });
});

describe("pickupLabel (D-006)", () => {
  it("says Pick up anytime for Now", () => {
    expect(pickupLabel("Now")).toBe("Pick up anytime");
  });
  it("says Pick up anytime when blank", () => {
    expect(pickupLabel(null)).toBe("Pick up anytime");
  });
  it("formats a calendar date as day and short month, without a leading zero", () => {
    expect(pickupLabel("2026-12-02")).toBe("Pick up from 2 Dec");
    expect(pickupLabel("2026-01-09")).toBe("Pick up from 9 Jan");
    expect(pickupLabel("2026-10-31")).toBe("Pick up from 31 Oct");
  });
  it("does not shift the day with the machine time zone (dates are plain calendar dates, D-030 rule 6)", () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ["Pacific/Honolulu", "Asia/Kolkata", "Pacific/Kiritimati"]) {
        process.env.TZ = tz;
        expect(pickupLabel("2026-12-02")).toBe("Pick up from 2 Dec");
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe("availabilityLabels (brief 6.2)", () => {
  it("has nothing to say for a single free unit", () => {
    expect(availabilityLabels(item({ id: "a", name: "a", quantity: 1, freeUnits: 1, unitsLeft: 1 }))).toEqual([]);
  });
  it("says '3 left' when quantity is above 1 and 3 units are free", () => {
    expect(availabilityLabels(item({ id: "a", name: "a", quantity: 3, freeUnits: 3, unitsLeft: 3 }))).toEqual(["3 left"]);
  });
  it("counts FREE units, not unsold ones: quantity 3 with 1 held and none sold is '2 left'", () => {
    // unitsLeft = quantity - sold = 3, freeUnits = 2. A buyer can only take the free ones.
    expect(availabilityLabels(item({ id: "a", name: "a", quantity: 3, freeUnits: 2, unitsLeft: 3 }))).toEqual(["2 left"]);
  });
  it("says '1 left' (not nothing) when a multi-quantity item is down to its last free unit", () => {
    expect(availabilityLabels(item({ id: "a", name: "a", quantity: 3, freeUnits: 1, unitsLeft: 2 }))).toEqual(["1 left"]);
  });
  it("says Reserved when there are no free units and nobody is waiting", () => {
    expect(availabilityLabels(item({ id: "a", name: "a", freeUnits: 0, waitingCount: 0 }))).toEqual(["Reserved"]);
  });
  it("says Reserved and 'N waiting' when there are no free units and a queue", () => {
    expect(availabilityLabels(item({ id: "a", name: "a", freeUnits: 0, waitingCount: 2 }))).toEqual(["Reserved", "2 waiting"]);
  });
  it("never shows a '0 left' or '0 waiting' label", () => {
    const all = [
      item({ id: "a", name: "a", freeUnits: 0, waitingCount: 0 }),
      item({ id: "b", name: "b", quantity: 2, freeUnits: 2, unitsLeft: 2 }),
    ].flatMap(availabilityLabels);
    expect(all.join(" ")).not.toMatch(/\b0 (left|waiting)\b/);
  });
});

describe("displayTitle and subtitle", () => {
  it("shows a Books row as 'name — author' (name first)", () => {
    expect(displayTitle(item({ id: "b", name: "Synthetic Novel", author: "A. Writer", tab: "Books" }))).toBe(
      "Synthetic Novel — A. Writer",
    );
  });
  it("shows just the name for a non-Books item, and the brand as the subtitle", () => {
    const k = item({ id: "k", name: "Test Kettle", brand: "Acme" });
    expect(displayTitle(k)).toBe("Test Kettle");
    expect(subtitle(k)).toBe("Acme");
  });
  it("has no subtitle when the brand is blank, and none for Books", () => {
    expect(subtitle(item({ id: "k", name: "Test Kettle", brand: null }))).toBeNull();
    expect(subtitle(item({ id: "b", name: "N", author: "A", tab: "Books" }))).toBeNull();
  });
  it("shows a Books row with no author as just the name (no dangling dash)", () => {
    expect(displayTitle(item({ id: "b", name: "Synthetic Novel", author: null, tab: "Books" }))).toBe("Synthetic Novel");
  });
});

describe("sortItems (brief 6.2)", () => {
  const free1 = item({ id: "f1", name: "free 1" });
  const res1 = item({ id: "r1", name: "res 1", freeUnits: 0 });
  const free2 = item({ id: "f2", name: "free 2", quantity: 2, freeUnits: 1, unitsLeft: 2 });
  const res2 = item({ id: "r2", name: "res 2", freeUnits: 0, waitingCount: 3 });

  it("puts items with free units first, then reserved, keeping sheet order within each group", () => {
    expect(sortItems([res1, free1, res2, free2]).map((i) => i.id)).toEqual(["f1", "f2", "r1", "r2"]);
  });
  it("does not mutate its input", () => {
    const input = [res1, free1];
    sortItems(input);
    expect(input.map((i) => i.id)).toEqual(["r1", "f1"]);
  });
  it("copes with empty and single-item lists", () => {
    expect(sortItems([])).toEqual([]);
    expect(sortItems([res1]).map((i) => i.id)).toEqual(["r1"]);
  });
  it("gives the same answer when applied twice", () => {
    const once = sortItems([res1, free1, res2, free2]);
    expect(sortItems(once)).toEqual(once);
  });
});

describe("reserveUrl (D-034: contactUrl + ?text=)", () => {
  it("starts with contactUrl and ?text=, and the decoded text contains the item name", () => {
    const url = reserveUrl(CONTACT_URL, "Test Kettle");
    expect(url).not.toBeNull();
    expect(url!.startsWith(`${CONTACT_URL}?text=`)).toBe(true);
    expect(new URL(url!).searchParams.get("text")).toContain("Test Kettle");
  });
  it("percent-encodes characters that would break the query: & # ? % + spaces, quotes and emoji", () => {
    const name = `Tom & Jerry's 50% #1? a+b "set" 🎾`;
    const url = reserveUrl(CONTACT_URL, name)!;
    const query = url.slice(url.indexOf("?"));
    expect(query).not.toMatch(/[ "#]/); // raw space, quote or hash would end or corrupt the query
    expect(query.slice(1).split("&")).toHaveLength(1); // the name's & is not a new parameter
    expect(new URL(url).searchParams.get("text")).toContain(name); // round-trips exactly
  });
  it("returns null when the server gave no contact URL (number unset)", () => {
    expect(reserveUrl(null, "Test Kettle")).toBeNull();
  });
});
