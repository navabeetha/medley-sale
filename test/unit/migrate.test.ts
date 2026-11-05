import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/api/migrate";
import type { MigrateResult } from "../../src/api/migrate";
import type { CellValue, Tab } from "../../src/api/sheet";
import { FakeSpreadsheet, FakeTab, counterRandom } from "../fixtures/fake-sheet";
import { BUYER_NAMES, FORMULA_NAME, ITEM_HEADERS, buildStaging } from "../fixtures/staging-fixture";

// S-03 acceptance, migrate(): adds 4.1 columns and tabs, State validation and
// the To do / Sold formulas; assigns stable IDs and quantity 1; one booking and
// one claim (with a token of at least 128 bits) per row with a Person;
// Reserved -> active, Sold -> sold at the listed price; rerun changes nothing;
// blank or unknown status stops with a clear error naming the row. T-17 too.

const NOW = "2026-11-03T10:00:00.000Z";
const ITEM_TABS = ["Tech", "Gym & Sport", "Home Things", "Books"];
const CLAIM_HEADERS = [
  "Claim ID", "Booking ID", "Item ID", "Item", "Name", "Number", "State", "Created",
  "Promoted at", "Notified", "Sold price", "Sold at", "Ended at", "Message link",
];
const BOOKING_HEADERS = ["Booking ID", "Token", "Name", "Number", "Created", "Idempotency key", "WhatsApp opened"];

afterEach(() => vi.restoreAllMocks());

function run(ss: FakeSpreadsheet, seed = 0, log?: (l: string) => void): MigrateResult {
  return migrate(ss, { randomBytes: counterRandom(seed).fn, now: () => NOW, log, allowUnscrubbed: true });
}
type Rec = Record<string, CellValue>;
function records(tab: Tab): Rec[] {
  const [head = [], ...rows] = tab.getGrid();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [String(h), r[i] ?? null])));
}
const tabOf = (ss: FakeSpreadsheet, name: string) => {
  const t = ss.getTab(name);
  if (!t) throw new Error(`missing tab ${name}`);
  return t;
};
const blank = (v: CellValue | undefined) => v === null || v === undefined || v === "";
const migrated = () => {
  const ss = buildStaging();
  const result = run(ss);
  return { ss, result };
};
const itemRecords = (ss: FakeSpreadsheet) => ITEM_TABS.flatMap((n) => records(tabOf(ss, n)));
const claimsOf = (ss: FakeSpreadsheet) => records(tabOf(ss, "Claims"));
const bookingsOf = (ss: FakeSpreadsheet) => records(tabOf(ss, "Bookings"));
/** Pretend the seller (or an earlier run) already added ID and Quantity to Tech. */
const addIdAndQuantity = (ss: FakeSpreadsheet) => {
  const tech = ss.getTab("Tech") as FakeTab;
  tech.setCell(1, 11, "ID");
  tech.setCell(1, 12, "Quantity");
  return tech;
};

describe("migrate structure (brief 4.1)", () => {
  it("creates Claims, Bookings, To do and Sold tabs", () => {
    const { ss } = migrated();
    for (const n of ["Claims", "Bookings", "To do", "Sold"]) expect(ss.getTab(n), n).toBeDefined();
  });

  it("gives Claims the 4.1 headers in order", () => {
    expect(tabOf(migrated().ss, "Claims").getGrid()[0]).toEqual(CLAIM_HEADERS);
  });

  it("gives Bookings the 4.1 headers in order", () => {
    expect(tabOf(migrated().ss, "Bookings").getGrid()[0]).toEqual(BOOKING_HEADERS);
  });

  it("appends ID and Quantity after the existing columns of every item tab and Template", () => {
    const { ss } = migrated();
    for (const n of [...ITEM_TABS, "Template"]) {
      const head = tabOf(ss, n).getGrid()[0]!;
      expect(head.slice(10), n).toEqual(["ID", "Quantity"]);
      expect(head.slice(0, 10), n).toHaveLength(10);
    }
  });

  it("does not move or rename the existing columns", () => {
    const { ss } = migrated();
    expect(tabOf(ss, "Tech").getGrid()[0]!.slice(0, 10)).toEqual(ITEM_HEADERS);
  });

  it("leaves the README tab alone", () => {
    const before = JSON.stringify(tabOf(buildStaging(), "README").getGrid());
    expect(JSON.stringify(tabOf(migrated().ss, "README").getGrid())).toBe(before);
  });

  it("restricts Claims State to active, released and sold", () => {
    const claims = tabOf(migrated().ss, "Claims");
    const col = CLAIM_HEADERS.indexOf("State") + 1;
    expect([...(claims.getDataValidation(col) ?? [])].sort()).toEqual(["active", "released", "sold"]);
  });

  it("puts a FILTER formula on the To do tab that reads from Claims", () => {
    const formulas = tabOf(migrated().ss, "To do").getFormulas().map((f) => f.formula);
    expect(formulas.some((f) => f.startsWith("=") && /FILTER/i.test(f) && f.includes("Claims"))).toBe(true);
  });

  it("puts a FILTER formula and a SUM total on the Sold tab", () => {
    const formulas = tabOf(migrated().ss, "Sold").getFormulas().map((f) => f.formula);
    expect(formulas.some((f) => /FILTER/i.test(f) && f.includes("Claims"))).toBe(true);
    expect(formulas.some((f) => /SUM/i.test(f))).toBe(true);
  });

  it("does not add a second ID or Quantity column to a tab that already has them", () => {
    const ss = buildStaging();
    const tech = addIdAndQuantity(ss);
    run(ss);
    const head = tech.getGrid()[0]!;
    expect(head.filter((h) => h === "ID")).toHaveLength(1);
    expect(head.filter((h) => h === "Quantity")).toHaveLength(1);
    expect(head).toHaveLength(12);
  });
});

describe("migrate IDs and quantities", () => {
  it("gives every item row in every item tab a non-blank ID", () => {
    const { ss } = migrated();
    for (const r of itemRecords(ss)) expect(blank(r["ID"]), String(r["Item"])).toBe(false);
  });

  it("makes IDs unique across all item tabs", () => {
    const ids = itemRecords(migrated().ss).map((r) => String(r["ID"]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps an ID that is already set and gives new IDs only to rows without one", () => {
    const ss = buildStaging();
    const tech = addIdAndQuantity(ss);
    tech.setCell(2, 11, "T-7");
    run(ss);
    const rows = records(tech);
    expect(rows[0]!["ID"]).toBe("T-7");
    expect(blank(rows[1]!["ID"])).toBe(false);
    expect(rows[1]!["ID"]).not.toBe("T-7");
  });

  it("keeps each item's ID when rows are reordered and the script runs again", () => {
    const { ss } = migrated();
    const byItem = (s: FakeSpreadsheet) =>
      Object.fromEntries(records(tabOf(s, "Tech")).map((r) => [String(r["Item"]), r["ID"]]));
    const before = byItem(ss);
    const tech = ss.getTab("Tech") as FakeTab;
    tech.grid = [tech.grid[0]!, ...tech.grid.slice(1).reverse()];
    run(ss);
    expect(byItem(ss)).toEqual(before);
  });

  it("sets blank quantities to 1 in item tabs", () => {
    for (const r of itemRecords(migrated().ss)) expect(r["Quantity"], String(r["Item"])).toBe(1);
  });

  it("sets a blank quantity to 1 in the Template tab too", () => {
    expect(records(tabOf(migrated().ss, "Template"))[0]!["Quantity"]).toBe(1);
  });

  it("keeps a quantity that is already set", () => {
    const ss = buildStaging();
    const tech = addIdAndQuantity(ss);
    tech.setCell(2, 12, 3);
    run(ss);
    expect(records(tech)[0]!["Quantity"]).toBe(3);
  });
});

describe("migrate bookings and claims", () => {
  it("creates exactly one claim and one booking per row that has a Person", () => {
    const { ss } = migrated();
    expect(claimsOf(ss)).toHaveLength(6);
    expect(bookingsOf(ss)).toHaveLength(6);
  });

  it("creates no claims for Available rows or the Template", () => {
    const { ss } = migrated();
    const names = claimsOf(ss).map((c) => c["Item"]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of ["Echo Dot", "Yoga mat", "Picture frame", "Free Fall", "Tiny Atlas", "Example item"]) {
      expect(names).not.toContain(n);
    }
  });

  it("turns Reserved into an active claim", () => {
    const c = claimsOf(migrated().ss).find((r) => r["Item"] === "Tripod")!;
    expect(c["State"]).toBe("active");
  });

  it("turns Sold into a sold claim at the listed price", () => {
    const claims = claimsOf(migrated().ss);
    const camera = claims.find((r) => r["Item"] === "Camera")!;
    expect(camera["State"]).toBe("sold");
    expect(camera["Sold price"]).toBe(4000);
    expect(claims.find((r) => r["Item"] === "Slow Rivers")!["Sold price"]).toBe(120);
  });

  it("leaves Sold price blank for an active claim", () => {
    const c = claimsOf(migrated().ss).find((r) => r["Item"] === "Tripod")!;
    expect(blank(c["Sold price"])).toBe(true);
  });

  it("leaves Sold price blank for a sold item with a blank price", () => {
    const ss = buildStaging();
    ss.getTab("Gym & Sport")!.setCell(3, 4, null); // Dumbbell pair, Sold, price now blank
    run(ss);
    const c = claimsOf(ss).find((r) => r["Item"] === "Dumbbell pair")!;
    expect(c["State"]).toBe("sold");
    expect(blank(c["Sold price"])).toBe(true);
  });

  it("links each claim to the ID of its item row and to a booking", () => {
    const { ss } = migrated();
    const idByItem = new Map(itemRecords(ss).map((r) => [String(r["Item"]), r["ID"]]));
    const bookingIds = new Set(bookingsOf(ss).map((b) => b["Booking ID"]));
    const claims = claimsOf(ss);
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(c["Item ID"], String(c["Item"])).toBe(idByItem.get(String(c["Item"])));
      expect(bookingIds.has(c["Booking ID"])).toBe(true);
    }
  });

  it("gives claims unique whole-number Claim IDs", () => {
    const ids = claimsOf(migrated().ss).map((c) => c["Claim ID"]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(Number.isInteger(id) && (id as number) > 0).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("copies the Person into the booking and claim Name, and stamps Created from the clock", () => {
    const { ss } = migrated();
    const tripod = claimsOf(ss).find((r) => r["Item"] === "Tripod")!;
    expect(tripod["Name"]).toBe("Asha Testperson");
    expect(tripod["Created"]).toBe(NOW);
    const booking = bookingsOf(ss).find((b) => b["Booking ID"] === tripod["Booking ID"])!;
    expect(booking["Name"]).toBe("Asha Testperson");
    expect(booking["Created"]).toBe(NOW);
  });

  it("does not change Status, Person, Price or Available from on item rows", () => {
    const before = buildStaging();
    const { ss } = migrated();
    for (const n of ITEM_TABS) {
      const strip = (s: FakeSpreadsheet) => tabOf(s, n).getGrid().map((r) => r.slice(0, 10));
      expect(strip(ss), n).toEqual(strip(before));
    }
  });
});

describe("migrate tokens (D-005)", () => {
  const tokens = (ss: FakeSpreadsheet) => bookingsOf(ss).map((b) => String(b["Token"]));

  it("gives every booking a token of letters and digits only, so the 6.3 guard never alters it", () => {
    const t = tokens(migrated().ss);
    expect(t.length).toBeGreaterThan(0);
    // 22 base-62 characters is about 131 bits; 32 hex characters is exactly 128.
    for (const x of t) expect(x).toMatch(/^[0-9A-Za-z]{22,}$/);
  });

  it("makes every token unique", () => {
    const t = tokens(migrated().ss);
    expect(t.length).toBeGreaterThan(0);
    expect(new Set(t).size).toBe(t.length);
  });

  it("draws at least 128 bits (16 bytes) from the injected random source per token", () => {
    const ss = buildStaging();
    const rnd = counterRandom();
    migrate(ss, { randomBytes: rnd.fn, now: () => NOW, allowUnscrubbed: true });
    const total = rnd.requested.reduce((a, b) => a + b, 0);
    expect(bookingsOf(ss).length).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(16 * bookingsOf(ss).length);
  });

  it("derives tokens from the injected source: same source same tokens, different source different tokens", () => {
    const a = buildStaging(), b = buildStaging(), c = buildStaging();
    run(a, 0); run(b, 0); run(c, 99);
    expect(tokens(a).length).toBeGreaterThan(0);
    expect(tokens(a)).toEqual(tokens(b));
    expect(tokens(a)).not.toEqual(tokens(c));
  });

  it("keeps tokens out of the Claims tab", () => {
    const { ss } = migrated();
    const claims = JSON.stringify(tabOf(ss, "Claims").getGrid());
    expect(tokens(ss).length).toBeGreaterThan(0);
    for (const t of tokens(ss)) expect(claims).not.toContain(t);
  });
});

describe("migrate is rerunnable", () => {
  it("changes nothing on a second run, even with a different random source", () => {
    const { ss } = migrated();
    const after1 = ss.snapshot();
    expect(claimsOf(ss).length).toBeGreaterThan(0);
    run(ss, 777);
    expect(ss.snapshot()).toBe(after1);
  });

  it("reports zero of every count on the second run", () => {
    const { ss, result } = migrated();
    const second = run(ss, 5);
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
    expect(Object.keys(second).sort()).toEqual(Object.keys(result).sort());
  });

  it("reports what the first run changed", () => {
    // Fixture hand count: 5 tabs (4 item + Template) x 2 new columns = 10; 4 new
    // tabs; 11 item rows (Tech 4, Gym 2, Home 1, Books 4) + 1 Template row get
    // quantity 1 = 12; 6 rows with a Person. idsAssigned is checked loosely
    // because whether Template rows get an ID is left open.
    const { result } = migrated();
    expect(result.columnsAdded).toBe(10);
    expect(result.tabsCreated).toBe(4);
    expect(result.quantitiesSet).toBe(12);
    expect(result.bookingsCreated).toBe(6);
    expect(result.claimsCreated).toBe(6);
    expect(result.idsAssigned).toBeGreaterThanOrEqual(11);
  });

  it("only adds the new row's booking and claim when a Reserved row is added later", () => {
    const { ss } = migrated();
    const tech = ss.getTab("Tech") as FakeTab;
    const claimsBefore = claimsOf(ss);
    const tokensBefore = bookingsOf(ss).map((b) => b["Token"]);
    tech.appendRow(["Kettle", "BrandX", "Cat", 500, "Now", "Reserved", "Kiran Sampleperson"]);
    const second = run(ss, 5);
    expect(second.claimsCreated).toBe(1);
    expect(second.bookingsCreated).toBe(1);
    expect(second.columnsAdded).toBe(0);
    expect(second.tabsCreated).toBe(0);
    expect(claimsOf(ss).slice(0, claimsBefore.length)).toEqual(claimsBefore);
    expect(bookingsOf(ss).slice(0, tokensBefore.length).map((b) => b["Token"])).toEqual(tokensBefore);
  });

  it("logs the counts for review without any names", () => {
    const logged: string[] = [];
    (["log", "info", "warn", "error", "debug"] as const).forEach((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" "))),
    );
    const ss = buildStaging();
    run(ss, 0, (l) => logged.push(l));
    const text = logged.join("\n");
    expect(logged.length).toBeGreaterThan(0);
    expect(text).toMatch(/\d/);
    for (const n of [...BUYER_NAMES, FORMULA_NAME]) expect(text).not.toContain(n);
  });
});

describe("migrate stops on a bad status", () => {
  const withStatus = (row: number, status: string | null) => {
    const ss = buildStaging();
    ss.getTab("Tech")!.setCell(row, 6, status);
    ss.getTab("Tech")!.setCell(row, 7, "Kiran Sampleperson");
    return ss;
  };

  it("throws an error naming the tab and row for an unknown status", () => {
    expect(() => run(withStatus(5, "Maybe"))).toThrow(/Tech.*\b5\b/);
  });

  it("throws an error naming the tab and row for a blank status", () => {
    expect(() => run(withStatus(3, null))).toThrow(/Tech.*\b3\b/);
  });

  it("does not put the person's name in the error", () => {
    let message = "";
    try { run(withStatus(5, "Maybe")); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/Tech/);
    expect(message).not.toContain("Kiran Sampleperson");
  });

  it("changes nothing in the sheet when it stops (checks every row before writing)", () => {
    const ss = withStatus(5, "Maybe");
    const before = ss.snapshot();
    expect(() => run(ss)).toThrow(/Tech/);
    expect(ss.snapshot()).toBe(before);
  });
});

describe("migrate spreadsheet safety (brief 6.3)", () => {
  it("writes a name that looks like a formula with a leading apostrophe", () => {
    const { ss } = migrated();
    const claim = claimsOf(ss).find((c) => c["Item"] === "Lamp")!;
    expect(claim["Name"]).toBe(`'${FORMULA_NAME}`);
    const booking = bookingsOf(ss).find((b) => b["Booking ID"] === claim["Booking ID"])!;
    expect(booking["Name"]).toBe(`'${FORMULA_NAME}`);
  });

  it("guards an item name that looks like a formula when it is copied into Claims", () => {
    const ss = buildStaging();
    ss.getTab("Tech")!.setCell(3, 1, "@SUM(1)"); // Tripod, Reserved
    run(ss);
    expect(claimsOf(ss).map((c) => c["Item"])).toContain("'@SUM(1)");
  });

  it("never writes a plain string starting with = + - or @ into any cell", () => {
    const ss = buildStaging();
    ss.getTab("Tech")!.setCell(3, 7, "-2+3");
    (ss.getTab("Tech") as FakeTab).writtenStrings = []; // forget the fixture edit itself
    run(ss);
    expect(claimsOf(ss).length).toBeGreaterThan(0);
    for (const tab of ss.tabs) {
      for (const s of tab.writtenStrings) expect(s, tab.name).not.toMatch(/^[=+\-@]/);
    }
  });
});

describe("T-17: fixture with every status, a blank price and date cells", () => {
  it("produces exactly the expected Claims rows", () => {
    const { ss } = migrated();
    const project = (c: Rec) => [c["Item"], c["Name"], c["State"], blank(c["Sold price"]) ? null : c["Sold price"], c["Created"]];
    // Order follows tab order then sheet order. Hand-derived from the fixture:
    // Reserved -> active; Sold -> sold at the listed price; Lamp's name is guarded.
    expect(claimsOf(ss).map(project)).toEqual([
      ["Tripod", "Asha Testperson", "active", null, NOW],
      ["Camera", "Ravi Samplename", "sold", 4000, NOW],
      ["Lamp", `'${FORMULA_NAME}`, "active", null, NOW],
      ["Dumbbell pair", "Meena Fixture", "sold", 1200, NOW],
      ["Night Garden", "Meena Fixture", "active", null, NOW],
      ["Slow Rivers", "Asha Testperson", "sold", 120, NOW],
    ]);
  });

  it("keeps blank price and blank or real date cells exactly as they were", () => {
    const { ss } = migrated();
    const yoga = records(tabOf(ss, "Gym & Sport"))[0]!;
    expect(yoga["Quantity"]).toBe(1); // migration ran
    expect(blank(yoga["Price"])).toBe(true);
    const books = records(tabOf(ss, "Books"));
    expect(blank(books[0]!["Available from"])).toBe(true); // Free Fall
    const atlas = books[3]!["Available from"];
    expect(atlas).toBeInstanceOf(Date);
    expect((atlas as Date).toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });

  it("changes nothing when the same fixture is migrated again", () => {
    const { ss } = migrated();
    const once = ss.snapshot();
    expect(claimsOf(ss).length).toBe(6);
    run(ss, 1);
    run(ss, 2);
    expect(ss.snapshot()).toBe(once);
  });
});
