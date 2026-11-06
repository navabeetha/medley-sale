// R1 / D-035 "status mode" and D-034 rule 4 (contactUrl). Synthetic data only.
//
// Interface chosen by the test author (src/api/catalogue.ts):
//   catalogue(ss, { ..., sellerWhatsapp?: string }): { items: CatalogueItem[]; contactUrl: string | null }
// The adapter reads Script Property SELLER_WHATSAPP and passes it in; the pure
// function does the digits-only normalisation. contactUrl is ALWAYS present
// (null when unset), including in engine mode.
//
// Status mode = the spreadsheet has no tab named "Claims". With a Claims tab the
// queue engine decides, exactly as before (covered by catalogue.test.ts).
import { describe, expect, it } from "vitest";
import { catalogue } from "../../src/api/catalogue";
import type { CellValue } from "../../src/api/sheet";
import { FakeSpreadsheet } from "../fixtures/fake-sheet";

type Item = Record<string, unknown> & { id: string; name: string };
type Resp = { items: Item[]; contactUrl: string | null };
const run = (ss: FakeSpreadsheet, opts: Record<string, unknown> = {}): Resp => catalogue(ss, opts as never) as unknown as Resp;
const byName = (r: Resp, name: string): Item => {
  const it = r.items.find((i) => i.name === name);
  if (!it) throw new Error(`no item ${name} in ${JSON.stringify(r.items.map((i) => i.name))}`);
  return it;
};

const TITLE = "Synthetic title row";
// Real-sheet shape for Books (live layout) plus the columns addIdColumns appends.
const BOOKS_HEADERS = ["Author", "Brand (+ Link)", "Available from", "Status", "Price", "Photos", null, null, "Notes", "Person", "ID", "Quantity"];
const ITEM_HEADERS = ["Item", "Brand", "Category", "Price", "Available from", "Status", "Person", "Notes", "ID", "Quantity"];
const NAMES = ["Asha Testperson", "Ravi Samplename", "Meena Fixture"];
const SELLER = "+91 90000 00001";

function tab(ss: FakeSpreadsheet, name: string, headers: (string | null)[], rows: Record<string, CellValue>[]) {
  return ss.withTab(name, [[TITLE], [...headers], ...rows.map((r) => headers.map((h) => (h === null ? null : (r[h] ?? null))))]);
}

/** Real-sheet-shaped: title row 1, headers row 2, Person filled, NO Claims or Bookings tab. */
function realSheet(): FakeSpreadsheet {
  const ss = new FakeSpreadsheet("Synthetic real sheet");
  tab(ss, "Tech", ITEM_HEADERS, [
    { Item: "Echo Dot", Brand: "BrandX", Price: 2500, Status: "Available", ID: "I-0001", Quantity: 1 },
    { Item: "Tripod", Brand: "BrandX", Price: 800, Status: "Reserved", Person: NAMES[0]!, Notes: "pickup Tuesday", ID: "I-0002", Quantity: 1 },
    { Item: "Camera", Brand: "BrandX", Price: 4000, Status: "Sold", Person: NAMES[1]!, ID: "I-0003", Quantity: 1 },
  ]);
  tab(ss, "Home Things", ITEM_HEADERS, [
    { Item: "Picture frame", Status: "Available", ID: "I-0004", Quantity: 4 },
    { Item: "Chair set", Status: "Reserved", Person: NAMES[2]!, ID: "I-0005", Quantity: 3 },
  ]);
  tab(ss, "Books", BOOKS_HEADERS, [
    { Author: "Author Q", "Brand (+ Link)": "Tiny Atlas", Status: "Available", Price: 90, ID: "I-0006", Quantity: 1 },
    { Author: "Author R", "Brand (+ Link)": "Night Garden", Status: "Reserved", Price: 150, Person: NAMES[0]!, ID: "I-0007", Quantity: 1 },
    { Author: "Author S", "Brand (+ Link)": "Slow Rivers", Status: "Sold", Person: NAMES[1]!, ID: "I-0008", Quantity: 1 },
  ]);
  return ss;
}

describe("status mode (no Claims tab): availability from the Status column (D-035)", () => {
  it("Available: unitsLeft and freeUnits equal Quantity, nobody waiting", () => {
    const r = run(realSheet());
    expect(byName(r, "Echo Dot")).toMatchObject({ quantity: 1, unitsLeft: 1, freeUnits: 1, waitingCount: 0 });
    expect(byName(r, "Picture frame")).toMatchObject({ quantity: 4, unitsLeft: 4, freeUnits: 4, waitingCount: 0 });
  });

  it("Reserved: unitsLeft stays at Quantity but freeUnits is 0", () => {
    const r = run(realSheet());
    expect(byName(r, "Tripod")).toMatchObject({ unitsLeft: 1, freeUnits: 0, waitingCount: 0 });
    // Whole quantity is held, not just one unit.
    expect(byName(r, "Chair set")).toMatchObject({ quantity: 3, unitsLeft: 3, freeUnits: 0, waitingCount: 0 });
  });

  it("Sold items are excluded", () => {
    const names = run(realSheet()).items.map((i) => i.name);
    expect(names).not.toContain("Camera");
    expect(names).not.toContain("Slow Rivers");
  });

  it("works on Books with the live layout (name under 'Brand (+ Link)', Author kept)", () => {
    const r = run(realSheet());
    expect(byName(r, "Tiny Atlas")).toMatchObject({ tab: "Books", author: "Author Q", brand: null, freeUnits: 1 });
    expect(byName(r, "Night Garden")).toMatchObject({ freeUnits: 0, unitsLeft: 1 });
  });

  it("lists exactly the Available and Reserved rows, in tab then row order", () => {
    expect(run(realSheet()).items.map((i) => i.id)).toEqual(["I-0001", "I-0002", "I-0004", "I-0005", "I-0006", "I-0007"]);
  });

  it.each([null, "", "   ", "Maybe", "Pending", "Gone"])("excludes a row whose Status is %j (fail closed)", (status) => {
    const ss = realSheet();
    tab(ss, "Gym & Sport", ITEM_HEADERS, [
      { Item: "Mystery item", Status: status, ID: "I-0009", Quantity: 1 },
      { Item: "Yoga mat", Status: "Available", ID: "I-0010", Quantity: 1 },
    ]);
    const names = run(ss).items.map((i) => i.name);
    expect(names).not.toContain("Mystery item");
    expect(names).toContain("Yoga mat");
  });

  it.each([null, 0, 1.5, -2])("still hides an unusable Quantity %j even when Available (D-026)", (q) => {
    const ss = realSheet();
    tab(ss, "Gym & Sport", ITEM_HEADERS, [{ Item: "Odd qty", Status: "Available", ID: "I-0009", Quantity: q }]);
    expect(run(ss).items.map((i) => i.name)).not.toContain("Odd qty");
  });

  it("still ignores rows with no ID or no name", () => {
    const ss = realSheet();
    tab(ss, "Gym & Sport", ITEM_HEADERS, [{ Item: "No id", Status: "Available", Quantity: 1 }, { Status: "Available", ID: "I-0009", Quantity: 1 }]);
    expect(run(ss).items.map((i) => i.tab)).not.toContain("Gym & Sport");
  });

  it("returns the same answer twice and changes nothing in the sheet", () => {
    const ss = realSheet();
    const before = ss.snapshot();
    const a = JSON.stringify(run(ss));
    expect(JSON.stringify(run(ss))).toBe(a);
    expect(ss.snapshot()).toBe(before);
  });

  it("an empty spreadsheet gives no items", () => {
    expect(run(new FakeSpreadsheet("Synthetic")).items).toEqual([]);
  });
});

describe("status mode: Person never read or emitted (T-12)", () => {
  it("emits no Person value anywhere in the JSON", () => {
    const json = JSON.stringify(run(realSheet(), { sellerWhatsapp: SELLER }));
    for (const n of NAMES) expect(json).not.toContain(n);
    expect(json).not.toContain("Test Person");
  });

  it("has exactly the D-030 item keys (no status, no person)", () => {
    for (const it of run(realSheet()).items) {
      expect(Object.keys(it).sort()).toEqual(
        ["author", "availableFrom", "brand", "category", "freeUnits", "id", "link", "name", "notes", "photos", "price", "quantity", "tab", "unitsLeft", "waitingCount"],
      );
    }
  });

  it("survives a formula or phone-like string in a Person cell without emitting it", () => {
    const ss = realSheet();
    // Person is column 7 of the Tech headers; data rows start on sheet row 3.
    ss.getTab("Tech")!.setCell(4, 7, '=IMPORTXML("https://example.invalid","//a")');
    ss.getTab("Tech")!.setCell(3, 7, "Call +91 90000 00077");
    const json = JSON.stringify(run(ss));
    expect(json).not.toContain("IMPORTXML");
    expect(json).not.toContain("90000 00077");
    expect(json).not.toContain("9000000077");
  });
});

describe("a Claims tab switches back to the queue engine (D-030 unchanged)", () => {
  it("with an empty Claims tab, Status is ignored: a Reserved row with no claims has a free unit", () => {
    const ss = realSheet();
    ss.withTab("Claims", [["Claim ID", "Booking ID", "Item ID", "State"]]);
    expect(byName(run(ss), "Tripod")).toMatchObject({ unitsLeft: 1, freeUnits: 1, waitingCount: 0 });
  });

  it("with a Claims tab, a Sold-status row without a sold claim is still listed", () => {
    const ss = realSheet();
    ss.withTab("Claims", [["Claim ID", "Booking ID", "Item ID", "State"]]);
    expect(run(ss).items.map((i) => i.name)).toContain("Camera");
  });
});

describe("contactUrl (D-034 rule 4)", () => {
  it("is a sibling of items on the response", () => {
    const r = run(realSheet(), { sellerWhatsapp: SELLER });
    // S-11 / D-038 rule 6 added `reserving` (see catalogue-reserving.test.ts).
    expect(Object.keys(r).sort()).toEqual(["contactUrl", "items", "reserving"]);
  });

  it("turns '+91 90000 00001' into https://wa.me/919000000001 with no text parameter", () => {
    // wa.me wants the international number as digits only: no +, spaces or leading zeros.
    expect(run(realSheet(), { sellerWhatsapp: SELLER }).contactUrl).toBe("https://wa.me/919000000001");
  });

  it.each([
    ["919000000001"],
    ["+919000000001"],
    ["  +91-90000-00001 "],
    ["+91 (90000) 00001"],
    ["0091 90000 00001"],
    ["00919000000001"],
  ])("normalises %j to the same wa.me URL", (raw) => {
    expect(run(realSheet(), { sellerWhatsapp: raw }).contactUrl).toBe("https://wa.me/919000000001");
  });

  it.each([[undefined], [""], ["   "], ["not a number"], ["+"], ["123"], ["+91 90000 0000199999999"], ["0000"]])(
    "is null for unset, blank or invalid input %j",
    (raw) => {
      expect(run(realSheet(), { sellerWhatsapp: raw as never }).contactUrl).toBeNull();
    },
  );

  it("is null (not missing) when the option is not passed at all", () => {
    const r = run(realSheet());
    expect("contactUrl" in r).toBe(true);
    expect(r.contactUrl).toBeNull();
  });

  it("is present in engine mode as well", () => {
    const ss = realSheet();
    ss.withTab("Claims", [["Claim ID", "Booking ID", "Item ID", "State"]]);
    expect(run(ss, { sellerWhatsapp: SELLER }).contactUrl).toBe("https://wa.me/919000000001");
  });

  it("never lets the number appear anywhere except inside contactUrl", () => {
    const r = run(realSheet(), { sellerWhatsapp: SELLER });
    const rest = JSON.stringify({ ...r, contactUrl: undefined });
    expect(rest).not.toContain("9000000001");
    expect(rest).not.toContain("90000 00001");
  });

  it("does not put the raw, unnormalised input in the response", () => {
    const json = JSON.stringify(run(realSheet(), { sellerWhatsapp: SELLER }));
    expect(json).not.toContain("+91 90000");
  });
});
