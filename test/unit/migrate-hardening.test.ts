import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, scrubStaging } from "../../src/api/migrate";
import type { MigrateResult } from "../../src/api/migrate";
import type { CellValue, Tab } from "../../src/api/sheet";
import { FakeSpreadsheet, FakeTab, counterRandom } from "../fixtures/fake-sheet";
import { BUYER_NAMES, FORMULA_NAME, ITEM_HEADERS, buildStaging } from "../fixtures/staging-fixture";

// S-03 QA fix round for migrate(): B1 guard, F5 freed IDs, F6 odd rows,
// "" status, and the first-row ID survivor. Synthetic data only.

const NOW = "2026-11-03T10:00:00.000Z";
afterEach(() => vi.restoreAllMocks());

/** Strict run: the guard is active. */
const strict = (ss: FakeSpreadsheet, log?: (l: string) => void): MigrateResult =>
  migrate(ss, { randomBytes: counterRandom().fn, now: () => NOW, log });
/** Guard on "has the scrub run" skipped; the BUILD COPY check still applies. */
const lax = (ss: FakeSpreadsheet, log?: (l: string) => void): MigrateResult =>
  migrate(ss, { randomBytes: counterRandom().fn, now: () => NOW, log, allowUnscrubbed: true });

type Rec = Record<string, CellValue>;
const records = (tab: Tab): Rec[] => {
  const [head = [], ...rows] = tab.getGrid();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [String(h), r[i] ?? null])));
};
const claimsOf = (ss: FakeSpreadsheet) => records(ss.getTab("Claims")!);
const blank = (v: CellValue | undefined) => v === null || v === undefined || v === "";
const row = (item: string, price: CellValue, status: string, person: string | null) =>
  [item, "BrandX", "Cat", price, "Now", status, person, null, null, null];
/** One-tab sheet. */
const one = (rows: CellValue[][], title = "A44 Garage Sale BUILD COPY") => {
  const ss = new FakeSpreadsheet(title);
  ss.withTab("Tech", [[...ITEM_HEADERS], ...rows]);
  return ss;
};
const scrubbed = () => {
  const ss = buildStaging();
  scrubStaging(ss);
  return ss;
};

describe("migrate guard (B1)", () => {
  it("refuses with a BUILD COPY error when the title lacks the marker", () => {
    expect(() => strict(one([row("A", 1, "Reserved", "Test Person 1")], "A44 Garage Sale"))).toThrow(/BUILD COPY/);
  });

  it("refuses a title without the marker even when allowUnscrubbed is set", () => {
    const ss = one([row("Kettle", 1, "Available", null)], "A44 Garage Sale");
    expect(() => lax(ss)).toThrow(/BUILD COPY/);
  });

  it("refuses when item tabs still hold an original Person, with a clear error that names no data", () => {
    const ss = buildStaging();
    let message = "";
    try { strict(ss); } catch (e) { message = String((e as Error).message); }
    expect(message).toMatch(/scrub/i);
    for (const n of [...BUYER_NAMES, FORMULA_NAME]) expect(message).not.toContain(n);
  });

  it("changes nothing when it refuses an unscrubbed sheet", () => {
    const ss = buildStaging();
    const before = ss.snapshot();
    expect(() => strict(ss)).toThrow();
    expect(ss.snapshot()).toBe(before);
  });

  it("changes nothing when it refuses a title without BUILD COPY", () => {
    const ss = buildStaging("A44 Garage Sale");
    const before = ss.snapshot();
    expect(() => strict(ss)).toThrow(/BUILD COPY/);
    expect(ss.snapshot()).toBe(before);
  });

  it("refuses when a single Person differs from the scrub format (Test Person)", () => {
    const ss = one([row("A", 1, "Reserved", "Test Person 1"), row("B", 1, "Reserved", "Test Person")]);
    expect(() => strict(ss)).toThrow(/scrub/i);
  });

  it("refuses a Person that only contains the scrub format (anchored match)", () => {
    expect(() => strict(one([row("A", 1, "Reserved", "Test Person 1 Asha")]))).toThrow(/scrub/i);
    expect(() => strict(one([row("A", 1, "Reserved", "Asha Test Person 1")]))).toThrow(/scrub/i);
  });

  it("refuses a numeric Person value", () => {
    expect(() => strict(one([row("A", 1, "Reserved", 42 as never)]))).toThrow(/scrub/i);
  });

  it("accepts blank Person cells and the scrub's Test Person <n> names", () => {
    const ss = one([row("A", 1, "Reserved", "Test Person 12"), row("B", 1, "Available", null), row("C", 1, "Available", "")]);
    expect(() => strict(ss)).not.toThrow();
  });

  it("migrates a sheet the scrub has just cleaned, and Claims names are scrubbed names", () => {
    const ss = scrubbed();
    expect(() => strict(ss)).not.toThrow();
    for (const c of claimsOf(ss)) expect(String(c["Name"])).toMatch(/^Test Person \d+$/);
  });

  it("migrate then scrub then migrate again still holds no original name anywhere (QA reproduction)", () => {
    const ss = buildStaging();
    lax(ss); // wrong order, as the seller might do by mistake
    scrubStaging(ss);
    for (const n of [...BUYER_NAMES, FORMULA_NAME]) expect(ss.snapshot()).not.toContain(n);
    expect(() => strict(ss)).not.toThrow();
  });
});

describe("migrate stops on an empty-string status (F6)", () => {
  it("throws the same error for '' as for null, naming the tab and row", () => {
    const run = (status: string | null) => {
      const ss = buildStaging();
      ss.getTab("Tech")!.setCell(3, 6, status);
      ss.getTab("Tech")!.setCell(3, 7, "Kiran Sampleperson");
      try { lax(ss); } catch (e) { return String((e as Error).message); }
      return "no error";
    };
    expect(run("")).toMatch(/Tech.*\b3\b/);
    expect(run("")).toBe(run(null));
  });

  it("changes nothing when it stops on ''", () => {
    const ss = buildStaging();
    ss.getTab("Tech")!.setCell(3, 6, "");
    const before = ss.snapshot();
    expect(() => lax(ss)).toThrow(/Tech/);
    expect(ss.snapshot()).toBe(before);
  });
});

describe("migrate reports rows that make no sense (F6)", () => {
  // Rows: 2 Reserved/Sold without a Person, 1 Available with a Person, 1 Sold
  // with a text price (and a Person), plus one normal Reserved row.
  const odd = () => one([
    row("NoPerson1", 100, "Reserved", null),
    row("NoPerson2", 100, "Sold", ""),
    row("Ghost", 100, "Available", "Kiran Sampleperson"),
    row("Haggle", "ask", "Sold", "Asha Testperson"),
    row("Normal", 100, "Reserved", "Ravi Samplename"),
  ]);

  it("counts Reserved or Sold rows with no Person", () => {
    expect(lax(odd()).reservedOrSoldWithoutPerson).toBe(2);
  });
  it("counts Available rows that have a Person", () => {
    expect(lax(odd()).availableWithPerson).toBe(1);
  });
  it("counts Sold rows whose price is text", () => {
    expect(lax(odd()).soldWithTextPrice).toBe(1);
  });
  it("makes no claim for rows without a Person or for an Available row", () => {
    const ss = odd();
    lax(ss);
    const items = claimsOf(ss).map((c) => String(c["Item"]));
    expect(items.sort()).toEqual(["Haggle", "Normal"]);
  });
  it("makes the claim for a text-price Sold row with a blank Sold price, as before", () => {
    const ss = odd();
    lax(ss);
    const haggle = claimsOf(ss).find((c) => c["Item"] === "Haggle")!;
    expect(haggle["State"]).toBe("sold");
    expect(blank(haggle["Sold price"])).toBe(true);
  });
  it("reports all three as zero for the clean fixture", () => {
    const r = lax(buildStaging());
    expect([r.reservedOrSoldWithoutPerson, r.availableWithPerson, r.soldWithTextPrice]).toEqual([0, 0, 0]);
  });
  it("puts each of the three counts in the log, by field name, without names", () => {
    const logged: string[] = [];
    lax(odd(), (l) => logged.push(l));
    const text = logged.join("\n");
    expect(text).toMatch(/reservedOrSoldWithoutPerson\D*2/);
    expect(text).toMatch(/availableWithPerson\D*1/);
    expect(text).toMatch(/soldWithTextPrice\D*1/);
    expect(text).not.toContain("Kiran Sampleperson");
  });
});

describe("migrate never reuses a freed Item ID (F5)", () => {
  it("gives a new Reserved row a fresh ID and its own claim after an earlier row was deleted (QA reproduction)", () => {
    const ss = buildStaging();
    lax(ss);
    const tech = ss.getTab("Tech") as FakeTab;
    const idCol = tech.getGrid()[0]!.indexOf("ID");
    const tripodIdx = tech.grid.findIndex((r) => r[0] === "Tripod");
    const freed = String(tech.grid[tripodIdx]![idCol]);
    expect(freed).toBe("I-0002"); // fixture guard: the Reserved row with I-0002
    const claimsBefore = claimsOf(ss);
    tech.grid.splice(tripodIdx, 1);
    tech.appendRow(["Kettle", "BrandX", "Cat", 500, "Now", "Reserved", "Test Person 9"]);

    const second = lax(ss);

    const kettle = records(tech).find((r) => r["Item"] === "Kettle")!;
    expect(kettle["ID"]).not.toBe(freed);
    expect(claimsBefore.some((c) => c["Item ID"] === kettle["ID"])).toBe(false);
    expect(second.claimsCreated).toBe(1);
    const claim = claimsOf(ss).find((c) => c["Item ID"] === kettle["ID"])!;
    expect(claim["Item"]).toBe("Kettle");
    expect(claim["State"]).toBe("active");
    // Tripod's old claim stays on its own ID, not on Kettle.
    expect(claimsOf(ss).filter((c) => c["Item ID"] === freed).map((c) => c["Item"])).toEqual(["Tripod"]);
  });

  it("also avoids the ID of a deleted row that was the last one", () => {
    const ss = buildStaging();
    lax(ss);
    const tech = ss.getTab("Tech") as FakeTab;
    const lastIdx = tech.grid.findIndex((r) => r[0] === "Lamp");
    const idCol = tech.getGrid()[0]!.indexOf("ID");
    const freed = String(tech.grid[lastIdx]![idCol]);
    tech.grid.splice(lastIdx, 1);
    tech.appendRow(["Kettle", "BrandX", "Cat", 500, "Now", "Available", null]);
    lax(ss);
    expect(records(tech).find((r) => r["Item"] === "Kettle")!["ID"]).not.toBe(freed);
  });
});

describe("migrate collects used IDs from every row (survivor)", () => {
  it("does not hand out the ID that the first data row already holds", () => {
    const ss = one([row("First", 1, "Available", null), row("Second", 1, "Available", null)]);
    const tech = ss.getTab("Tech") as FakeTab;
    tech.setCell(1, 11, "ID");
    tech.setCell(1, 12, "Quantity");
    tech.setCell(2, 11, "I-0001");
    lax(ss);
    const ids = records(tech).map((r) => String(r["ID"]));
    expect(ids[0]).toBe("I-0001");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
