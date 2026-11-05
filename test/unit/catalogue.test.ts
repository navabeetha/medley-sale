// S-04: the public catalogue handler (brief 4.3, 6.1, 6.2; D-009, D-011, D-026, D-027, D-028).
//
// DESIGNED INTERFACE (the tests below are the spec for src/api/catalogue.ts):
//
//   catalogue(ss: Spreadsheet, opts?: { photoCounts?: Record<string, number> }): CatalogueResponse
//
//   CatalogueResponse = { items: CatalogueItem[] }          // JSON-able, nothing else needed
//   CatalogueItem = {
//     id: string;                 // the ID column
//     tab: string;                // "Tech" | "Gym & Sport" | "Home Things" | "Books"
//     name: string;               // Item column; on Books the book name (D-028 lookup)
//     brand: string | null;       // brand cell; null on Books (that cell is the name there)
//     author: string | null;      // Books only, else null
//     category: string | null;    // Category column if present, else null
//     price: number | null;       // blank -> null
//     availableFrom: string | null; // Date cell -> ISO string (starts "YYYY-MM-DD"); text such as "Now" passes through; blank -> null
//     notes: string | null;
//     link: string | null;        // rich-text link on the brand / book-name cell; http(s) only, else null
//     quantity: number;
//     unitsLeft: number;          // from src/domain/queue recalculate (quantity - sold)
//     freeUnits: number;          // from recalculate (EXTRA field: the site needs it for "3 left" / "Reserved")
//     waitingCount: number;       // from recalculate
//     photos: number;             // opts.photoCounts[id] ?? 0 (floating sheet images are not readable here)
//   }
//   Order: tab order in the spreadsheet, then sheet row order. No other field names may appear.
//
// The handler must reuse findHeaderRow (D-027) and the same name-column lookup as migrate
// (`itemNameCol` in src/api/migrate.ts, to be exported). Synthetic data only.
import { describe, expect, it } from "vitest";
import { catalogue } from "../../src/api/catalogue";
import { migrate, scrubStaging } from "../../src/api/migrate";
import type { CellValue } from "../../src/api/sheet";
import { counterRandom, FakeSpreadsheet, type FakeTab } from "../fixtures/fake-sheet";
import { buildStagingTitled } from "../fixtures/title-row-fixture";

type Item = Record<string, unknown> & { id: string; name: string; tab: string };
const items = (ss: FakeSpreadsheet, opts?: { photoCounts?: Record<string, number> }): Item[] =>
  (catalogue(ss, opts) as unknown as { items: Item[] }).items;
const byName = (list: Item[], name: string): Item => {
  const it = list.find((i) => i.name === name);
  if (!it) throw new Error(`no item named ${name} in ${JSON.stringify(list.map((i) => i.name))}`);
  return it;
};

const TITLE = "Synthetic title row";
const ITEM_HEADERS = ["Item", "Brand", "Category", "Price", "Available from", "Status", "Person", "Notes", "Photo", "ID", "Quantity"];
// Live Books layout (row 2 of the build copy, 2026-11-05) plus the columns migrate appends.
const LIVE_BOOKS_HEADERS = [
  "Author", "Brand (+ Link)", "Available from", "Status", "Price", "Photos", null, null, "Notes", "Person", "ID", "Quantity",
];

/** A tab with a title row 1, headers on row 2, then one row per object keyed by header. */
function addTab(
  ss: FakeSpreadsheet, name: string, headers: (string | null)[], rows: Record<string, CellValue>[],
): FakeTab {
  return ss.withTab(name, [
    [TITLE],
    [...headers],
    ...rows.map((r) => headers.map((h) => (h === null ? null : (r[h] ?? null)))),
  ]);
}

const CLAIM_HEADERS = [
  "Claim ID", "Booking ID", "Item ID", "Item", "Name", "Number", "State", "Created",
  "Promoted at", "Notified", "Sold price", "Sold at", "Ended at", "Message link",
];
const BOOKING_HEADERS = ["Booking ID", "Token", "Name", "Number", "Created", "Idempotency key", "WhatsApp opened"];

let claimSeq = 0;
/** Appends a claim whose private cells all hold recognisable, invented values. */
function addClaim(ss: FakeSpreadsheet, itemId: string, state: "active" | "released" | "sold", tag = ++claimSeq) {
  const claims = (ss.getTab("Claims") ?? ss.withTab("Claims", [[...CLAIM_HEADERS]])) as FakeTab;
  claims.appendRow([
    tag, `BK-ZQ${tag}`, itemId, "ignored item text", `Zed Buyer${tag}`, `+91 90000 0${String(tag).padStart(4, "0")}`,
    state, "2026-11-01T10:00:00.000Z", null, null, null, null, null, `https://wa.me/zq${tag}`,
  ]);
}
function addBooking(ss: FakeSpreadsheet, tag: number) {
  const b = (ss.getTab("Bookings") ?? ss.withTab("Bookings", [[...BOOKING_HEADERS]])) as FakeTab;
  b.appendRow([`BK-ZQ${tag}`, `tok-secret-${tag}-abcdef`, `Zed Buyer${tag}`, `+91 90000 0${String(tag).padStart(4, "0")}`,
    "2026-11-01T10:00:00.000Z", `idem-${tag}-xyz`, null]);
}

/** One of everything, all four tabs. */
function build(brandHeader = "Brand"): FakeSpreadsheet {
  const ss = new FakeSpreadsheet("Synthetic sale");
  const headers = ITEM_HEADERS.map((h) => (h === "Brand" ? brandHeader : h));
  const row = (id: string, item: string, extra: Record<string, CellValue> = {}): Record<string, CellValue> => ({
    Item: item, [brandHeader]: "BrandX", Category: "Cat", Price: 100, "Available from": "Now", Status: "Available",
    ID: id, Quantity: 1, ...extra,
  });
  addTab(ss, "Tech", headers, [
    row("I-0001", "Echo Dot", { Price: 2500, Notes: "Works fine", Photo: "x.jpg" }),
    row("I-0002", "Tripod", { Status: "Reserved", Person: "Test Person 1" }),
  ]).setLink(3, headers.indexOf(brandHeader) + 1, "https://example.invalid/echo");
  addTab(ss, "Gym & Sport", headers, [row("I-0003", "Yoga mat", { Price: null })]);
  addTab(ss, "Home Things", headers, [row("I-0004", "Picture frame", { Quantity: 4 })]);
  const books = addTab(ss, "Books", LIVE_BOOKS_HEADERS, [
    { Author: "Author Q", "Brand (+ Link)": "Tiny Atlas", "Available from": new Date(Date.UTC(2026, 11, 2)), Status: "Available", Price: 90, ID: "I-0005", Quantity: 1 },
    { Author: "Author R", "Brand (+ Link)": "Free Fall", "Available from": null, Status: "Available", Price: null, ID: "I-0006", Quantity: 1 },
  ]);
  books.setLink(3, 2, "https://example.invalid/atlas");
  addTab(ss, "Template", headers, [row("", "Example item")]);
  return ss;
}

describe("catalogue: fields across all four tabs (4.3)", () => {
  it("lists items from Tech, Gym & Sport, Home Things and Books in tab then row order, never Template", () => {
    const list = items(build());
    expect(list.map((i) => i.name)).toEqual(["Echo Dot", "Tripod", "Yoga mat", "Picture frame", "Tiny Atlas", "Free Fall"]);
    expect(list.map((i) => i.tab)).toEqual(["Tech", "Tech", "Gym & Sport", "Home Things", "Books", "Books"]);
  });

  it("returns id, name, brand, category, price, availableFrom, notes, quantity for an ordinary item", () => {
    const echo = byName(items(build()), "Echo Dot");
    expect(echo).toMatchObject({
      id: "I-0001", tab: "Tech", name: "Echo Dot", brand: "BrandX", category: "Cat",
      price: 2500, availableFrom: "Now", notes: "Works fine", quantity: 1,
    });
  });

  it("uses only the documented field names (no stray columns such as Status or Person)", () => {
    const echo = byName(items(build()), "Echo Dot");
    expect(Object.keys(echo).sort()).toEqual(
      ["author", "availableFrom", "brand", "category", "freeUnits", "id", "link", "name", "notes", "photos", "price", "quantity", "tab", "unitsLeft", "waitingCount"],
    );
  });

  it.each(["Brand", "Brand (+ Link)"])("reads the brand and its link when the brand column is headed %j", (header) => {
    const echo = byName(items(build(header)), "Echo Dot");
    expect(echo.brand).toBe("BrandX");
    expect(echo.link).toBe("https://example.invalid/echo");
  });

  it("gives link null when the brand cell has no rich-text link", () => {
    expect(byName(items(build()), "Tripod").link).toBeNull();
  });

  it("drops a link that is not http or https (it would become an href on the site)", () => {
    const ss = build();
    (ss.getTab("Tech") as FakeTab).setLink(4, 2, "javascript:alert(1)");
    expect(byName(items(ss), "Tripod").link).toBeNull();
  });
});

describe("catalogue: Books mapping (4.1, D-028)", () => {
  it("takes the book name from 'Brand (+ Link)' and the author from 'Author' on the live layout", () => {
    const atlas = byName(items(build()), "Tiny Atlas");
    expect(atlas).toMatchObject({ tab: "Books", name: "Tiny Atlas", author: "Author Q", brand: null });
  });

  it("takes the book's product link from the rich-text link on the name cell", () => {
    expect(byName(items(build()), "Tiny Atlas").link).toBe("https://example.invalid/atlas");
    expect(byName(items(build()), "Free Fall").link).toBeNull();
  });

  it("accepts plain 'Brand' as the book name column too", () => {
    const ss = build();
    (ss.getTab("Books") as FakeTab).setCell(2, 2, "Brand");
    expect(byName(items(ss), "Tiny Atlas").author).toBe("Author Q");
  });

  it("prefers an 'Item' column on Books when both Item and Brand exist", () => {
    const ss = build();
    const books = ss.getTab("Books") as FakeTab;
    books.setCell(2, 13, "Item");
    books.setCell(3, 13, "Atlas by Item");
    expect(items(ss).find((i) => i.tab === "Books" && i.id === "I-0005")!.name).toBe("Atlas by Item");
  });

  it("does not use Author as the name, and gives non-Books items author null", () => {
    const list = items(build());
    expect(list.filter((i) => i.tab === "Books").map((i) => i.name)).not.toContain("Author Q");
    expect(byName(list, "Echo Dot").author).toBeNull();
  });
});

describe("catalogue: blank price and date cells", () => {
  it("returns null for a blank price, on item tabs and Books", () => {
    const list = items(build());
    expect(byName(list, "Yoga mat").price).toBeNull();
    expect(byName(list, "Free Fall").price).toBeNull();
  });

  it("returns a real number for a priced item", () => {
    expect(byName(items(build()), "Tiny Atlas").price).toBe(90);
  });

  it("turns a Date cell in 'Available from' into an ISO date string", () => {
    const from = byName(items(build()), "Tiny Atlas").availableFrom;
    expect(typeof from).toBe("string");
    // The fixture date is 2 Dec 2026 (UTC midnight); date-only or full ISO both start like this.
    expect(from as string).toMatch(/^2026-12-02/);
    expect(Number.isNaN(Date.parse(from as string))).toBe(false);
  });

  it("returns null for a blank 'Available from' and passes text such as 'Now' through", () => {
    const list = items(build());
    expect(byName(list, "Free Fall").availableFrom).toBeNull();
    expect(byName(list, "Echo Dot").availableFrom).toBe("Now");
  });
});

describe("catalogue: columns are found by name, not position", () => {
  it("reads the same data when item-tab columns are in reverse order", () => {
    const ss = build();
    const reversed = new FakeSpreadsheet("Synthetic sale");
    for (const t of ss.tabs) {
      reversed.withTab(t.name, t.grid.map((r) => (r.length > 1 ? [...r].reverse() : [...r])));
    }
    // Links are position-bound, so compare everything except link.
    const strip = (l: Item[]) => l.map((i) => ({ ...i, link: null }));
    expect(strip(items(reversed))).toEqual(strip(items(ss)));
  });

  it("finds Claims columns by header too (State and Item ID swapped)", () => {
    const ss = build();
    const swap = (r: CellValue[]) => { const c = [...r]; [c[2], c[6]] = [c[6]!, c[2]!]; return c; };
    const claims = ss.withTab("Claims", [swap(CLAIM_HEADERS)]);
    claims.appendRow(swap([1, "BK-ZQ1", "I-0001", "x", "Zed Buyer1", "n", "sold", "t", null, null, null, null, null, null]));
    expect(items(ss).map((i) => i.name)).not.toContain("Echo Dot");
  });
});

describe("catalogue: unitsLeft, waitingCount and exclusions (6.1, D-026)", () => {
  it("reports full units and nobody waiting when there are no claims", () => {
    const frame = byName(items(build()), "Picture frame");
    expect(frame).toMatchObject({ quantity: 4, unitsLeft: 4, freeUnits: 4, waitingCount: 0 });
  });

  it("keeps unitsLeft at quantity for a reserved single item but frees no unit", () => {
    const ss = build();
    addClaim(ss, "I-0002", "active");
    expect(byName(items(ss), "Tripod")).toMatchObject({ unitsLeft: 1, freeUnits: 0, waitingCount: 0 });
  });

  it("counts active claims beyond the units as waiting", () => {
    const ss = build();
    for (let i = 0; i < 3; i++) addClaim(ss, "I-0002", "active");
    expect(byName(items(ss), "Tripod")).toMatchObject({ unitsLeft: 1, freeUnits: 0, waitingCount: 2 });
  });

  it("ignores released claims", () => {
    const ss = build();
    addClaim(ss, "I-0002", "released");
    expect(byName(items(ss), "Tripod")).toMatchObject({ unitsLeft: 1, freeUnits: 1, waitingCount: 0 });
  });

  it("subtracts sold claims from unitsLeft on a multi-unit item", () => {
    const ss = build();
    addClaim(ss, "I-0004", "sold");
    addClaim(ss, "I-0004", "active");
    expect(byName(items(ss), "Picture frame")).toMatchObject({ unitsLeft: 3, freeUnits: 2, waitingCount: 0 });
  });

  it("only counts claims for the item's own ID", () => {
    const ss = build();
    addClaim(ss, "I-0001", "active");
    expect(byName(items(ss), "Yoga mat")).toMatchObject({ unitsLeft: 1, freeUnits: 1, waitingCount: 0 });
  });

  it("excludes a sold-out item, waiters on it included", () => {
    const ss = build();
    addClaim(ss, "I-0001", "sold");
    addClaim(ss, "I-0001", "active");
    expect(items(ss).map((i) => i.name)).not.toContain("Echo Dot");
  });

  it("keeps an item with some units sold but some left", () => {
    const ss = build();
    addClaim(ss, "I-0004", "sold");
    expect(items(ss).map((i) => i.name)).toContain("Picture frame");
  });

  it("excludes quantity 0 and a non-whole quantity (unavailable, D-026)", () => {
    const ss = build();
    (ss.getTab("Tech") as FakeTab).setCell(4, 11, 0); // Tripod
    (ss.getTab("Gym & Sport") as FakeTab).setCell(3, 11, 1.5); // Yoga mat
    const names = items(ss).map((i) => i.name);
    expect(names).not.toContain("Tripod");
    expect(names).not.toContain("Yoga mat");
    expect(names).toContain("Echo Dot");
  });
});

describe("catalogue: photo count", () => {
  it("is 0 unless the caller supplies a count for the item ID", () => {
    expect(byName(items(build()), "Echo Dot").photos).toBe(0);
  });
  it("uses the supplied count for that item ID only", () => {
    const list = items(build(), { photoCounts: { "I-0001": 3 } });
    expect(byName(list, "Echo Dot").photos).toBe(3);
    expect(byName(list, "Tripod").photos).toBe(0);
  });
});

describe("catalogue: purity", () => {
  it("returns the same answer twice and changes nothing in the sheet", () => {
    const ss = build();
    addClaim(ss, "I-0002", "active");
    const before = ss.snapshot();
    const a = JSON.stringify(catalogue(ss));
    expect(JSON.stringify(catalogue(ss))).toBe(a);
    expect(ss.snapshot()).toBe(before);
  });

  it("returns an empty list when no item has anything to sell", () => {
    expect(items(new FakeSpreadsheet("Synthetic sale"))).toEqual([]);
  });
});

// ---- T-12: nothing from Claims, Bookings or Person may reach the response.

/** Every string cell below the header row in the given columns, trimmed, 3+ chars. */
function cellsOf(tab: FakeTab | undefined, headerRow: number, headers: string[]): string[] {
  if (!tab) return [];
  const g = tab.getGrid();
  const head = g[headerRow] ?? [];
  const cols = headers.map((h) => head.indexOf(h)).filter((c) => c >= 0);
  const out: string[] = [];
  for (const r of g.slice(headerRow + 1)) {
    for (const c of cols) if (typeof r[c] === "string" && (r[c] as string).trim().length >= 3) out.push((r[c] as string).trim());
  }
  return out;
}

function privateValues(ss: FakeSpreadsheet): string[] {
  // Item / Item ID / State / Claim ID on Claims are legitimately public (name, id) or bare
  // numbers, so they are excluded; every other Claims cell and every Bookings cell is private.
  const claimsPrivate = CLAIM_HEADERS.filter((h) => !["Item", "Item ID", "State", "Claim ID"].includes(h));
  const values = [
    ...cellsOf(ss.getTab("Claims") as FakeTab, 0, claimsPrivate),
    ...cellsOf(ss.getTab("Bookings") as FakeTab, 0, BOOKING_HEADERS),
  ];
  for (const t of ss.tabs) {
    if (["Claims", "Bookings", "To do", "Sold", "README", "Template"].includes(t.name)) continue;
    values.push(...cellsOf(t, 1, ["Person"]));
  }
  return [...new Set(values)];
}

function allKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); allKeys(x, out); }
  return out;
}

describe("catalogue: T-12 response scan (D-009, D-011)", () => {
  function sensitive(): FakeSpreadsheet {
    const ss = build();
    addClaim(ss, "I-0002", "active", 1);
    addClaim(ss, "I-0002", "active", 2);
    addClaim(ss, "I-0001", "released", 3);
    addClaim(ss, "I-0001", "sold", 4); // Echo Dot sold out and excluded
    for (const n of [1, 2, 3, 4]) addBooking(ss, n);
    (ss.getTab("Tech") as FakeTab).setCell(4, 7, "Zed Person Holder"); // Tripod's Person
    (ss.getTab("Books") as FakeTab).setCell(3, 10, "Zed Person Author"); // Tiny Atlas's Person
    return ss;
  }

  it("the scan itself sees the private values (guards against an empty check)", () => {
    const values = privateValues(sensitive());
    expect(values).toEqual(expect.arrayContaining(["Zed Buyer1", "tok-secret-1-abcdef", "BK-ZQ2", "Zed Person Holder", "Zed Person Author"]));
    expect(values.length).toBeGreaterThan(15);
  });

  it("contains no Claims or Bookings cell value and no Person value anywhere in the JSON", () => {
    const ss = sensitive();
    const json = JSON.stringify(catalogue(ss));
    expect(json.length).toBeGreaterThan(50);
    const leaked = privateValues(ss).filter((v) => json.includes(v));
    expect(leaked).toEqual([]);
  });

  it("contains no digit run that looks like a phone number", () => {
    const json = JSON.stringify(catalogue(sensitive()));
    expect(json).not.toMatch(/9000\s?0\s?0/);
    expect(json).not.toMatch(/\d{10,}/);
  });

  it("has no property named after private data", () => {
    const keys = allKeys(catalogue(sensitive()));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(k).not.toMatch(/^(buyer.*|person.*|name_.+|.*_name|number|phone|token|booking.*|claim.*|holder.*|status)$/i);
    // The bare "name" key is the item name (D-030), so it is allowed; buyer-ish name keys are not.
    expect(keys).toContain("name");
  });
});

// ---- End to end on the migrated shape (S-03 output).

describe("catalogue on a scrubbed and migrated titled fixture", () => {
  function migrated(booksNameHeader?: string): FakeSpreadsheet {
    const ss = buildStagingTitled();
    if (booksNameHeader) {
      const books = ss.getTab("Books") as FakeTab;
      const head = books.getGrid()[1]!;
      books.setCell(2, head.indexOf("Item") + 1, booksNameHeader);
    }
    scrubStaging(ss);
    migrate(ss, { randomBytes: counterRandom().fn, now: () => "2026-11-05T10:00:00.000Z" });
    return ss;
  }

  it.each([undefined, "Brand (+ Link)"])("lists unsold items and hides sold ones (Books name header %s)", (hdr) => {
    const names = items(migrated(hdr)).map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["Echo Dot", "Tripod", "Lamp", "Yoga mat", "Picture frame", "Free Fall", "Night Garden", "Tiny Atlas"]));
    // Camera, Dumbbell pair and Slow Rivers are Sold with a claim, quantity 1: sold out.
    for (const sold of ["Camera", "Dumbbell pair", "Slow Rivers"]) expect(names).not.toContain(sold);
    expect(names).not.toContain("Example item"); // Template
    expect(names).toHaveLength(8);
  });

  it("shows a Reserved item as held: unitsLeft 1, freeUnits 0, nobody waiting", () => {
    expect(byName(items(migrated()), "Tripod")).toMatchObject({ unitsLeft: 1, freeUnits: 0, waitingCount: 0 });
    expect(byName(items(migrated()), "Echo Dot")).toMatchObject({ unitsLeft: 1, freeUnits: 1, waitingCount: 0 });
  });

  it("keeps Books mapping, null price and ISO date after migration", () => {
    const list = items(migrated("Brand (+ Link)"));
    expect(byName(list, "Free Fall")).toMatchObject({ tab: "Books", author: "Author Q", price: null });
    expect(byName(list, "Tiny Atlas").availableFrom).toMatch(/^2026-12-02/);
  });

  it("leaks nothing from Claims, Bookings or Person after migration", () => {
    const ss = migrated();
    const json = JSON.stringify(catalogue(ss));
    const values = privateValues(ss);
    expect(values.length).toBeGreaterThan(3); // scrubbed names and tokens exist
    expect(values.filter((v) => json.includes(v))).toEqual([]);
  });
});
