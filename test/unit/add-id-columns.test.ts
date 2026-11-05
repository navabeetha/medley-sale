// R1 / D-035 rule 3: addIdColumns(ss), the editor function that prepares the REAL
// sheet. Interface chosen by the test author:
//
//   // src/api/add-id-columns.ts
//   addIdColumns(ss: Spreadsheet, opts?: { log?: (line: string) => void }):
//     { columnsAdded: number; idsAssigned: number; quantitiesSet: number }
//
// Counts only (they feed a log line). Never reads or writes Person, never
// creates a tab, and has no BUILD COPY guard (it is meant for the real sheet).
// Synthetic data only.
import { describe, expect, it } from "vitest";
import { addIdColumns } from "../../src/api/add-id-columns";
import { migrate, scrubStaging } from "../../src/api/migrate";
import { counterRandom, type FakeSpreadsheet, type FakeTab } from "../fixtures/fake-sheet";
import { buildStagingTitled } from "../fixtures/title-row-fixture";

const REAL_TITLE = "Synthetic real sheet"; // deliberately no BUILD COPY
const NOW = "2026-11-05T10:00:00.000Z";
const ITEM_TABS = ["Tech", "Gym & Sport", "Home Things", "Books"];

const headerRow = (t: FakeTab): number => t.grid.findIndex((r) => r.includes("Person"));
const colOf = (t: FakeTab, name: string): number => t.grid[headerRow(t)]!.indexOf(name) + 1;

/** item name -> ID, keyed "Tab/name", read by header name. Rows with no ID are skipped. */
function idsByName(ss: FakeSpreadsheet): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ITEM_TABS) {
    const t = ss.getTab(name) as FakeTab;
    const nameCol = colOf(t, "Item");
    const idCol = colOf(t, "ID");
    for (const r of t.grid.slice(headerRow(t) + 1)) {
      if (r[idCol - 1]) out[`${name}/${r[nameCol - 1]}`] = String(r[idCol - 1]);
    }
  }
  return out;
}
const personColumn = (ss: FakeSpreadsheet): unknown[] =>
  ITEM_TABS.flatMap((n) => {
    const t = ss.getTab(n) as FakeTab;
    const c = colOf(t, "Person");
    return t.grid.slice(headerRow(t) + 1).map((r) => r[c - 1] ?? null);
  });

const real = (): FakeSpreadsheet => buildStagingTitled({}, REAL_TITLE);

describe("addIdColumns: headers", () => {
  it("adds ID then Quantity at the far right of each item tab's header row (row 2 under a title)", () => {
    const ss = real();
    const widths = ITEM_TABS.map((n) => (ss.getTab(n) as FakeTab).grid[1]!.length);
    addIdColumns(ss);
    ITEM_TABS.forEach((n, i) => {
      const head = (ss.getTab(n) as FakeTab).grid[1]!;
      expect(head[widths[i]!]).toBe("ID");
      expect(head[widths[i]! + 1]).toBe("Quantity");
      expect(head.length).toBe(widths[i]! + 2);
    });
  });

  it("does not touch the title row above the header", () => {
    const ss = real();
    const titles = ITEM_TABS.map((n) => JSON.stringify((ss.getTab(n) as FakeTab).grid[0]));
    addIdColumns(ss);
    expect(ITEM_TABS.map((n) => JSON.stringify((ss.getTab(n) as FakeTab).grid[0]))).toEqual(titles);
  });

  it("only adds the missing header when ID is already there", () => {
    const ss = real();
    const tech = ss.getTab("Tech") as FakeTab;
    tech.setCell(2, tech.grid[1]!.length + 1, "ID");
    const r = addIdColumns(ss);
    expect(tech.grid[1]!.filter((h) => h === "ID")).toHaveLength(1);
    expect(tech.grid[1]!.filter((h) => h === "Quantity")).toHaveLength(1);
    expect(r.columnsAdded).toBe(ITEM_TABS.length * 2 - 1);
  });

  it("leaves Template, README and every other non-item tab untouched", () => {
    const ss = real();
    const before = ["Template", "README"].map((n) => JSON.stringify((ss.getTab(n) as FakeTab).grid));
    addIdColumns(ss);
    expect(["Template", "README"].map((n) => JSON.stringify((ss.getTab(n) as FakeTab).grid))).toEqual(before);
  });

  it("creates no new tabs (no Claims, Bookings, To do or Sold)", () => {
    const ss = real();
    const names = ss.getTabs().map((t) => t.name);
    addIdColumns(ss);
    expect(ss.getTabs().map((t) => t.name)).toEqual(names);
  });

  it("works on a sheet whose title has no BUILD COPY, and on one that has it", () => {
    expect(() => addIdColumns(real())).not.toThrow();
    expect(() => addIdColumns(buildStagingTitled())).not.toThrow();
  });

  it("works when the header is on row 1 (no title row)", () => {
    const ss = buildStagingTitled({ Tech: 1, "Gym & Sport": 1, "Home Things": 1, Books: 1 }, REAL_TITLE);
    addIdColumns(ss);
    expect(colOf(ss.getTab("Tech") as FakeTab, "ID")).toBeGreaterThan(0);
    expect(Object.keys(idsByName(ss)).length).toBeGreaterThan(0);
  });
});

describe("addIdColumns: IDs and quantities", () => {
  it("gives every non-empty data row an I-NNNN ID in tab then row order, from I-0001", () => {
    const ss = real();
    addIdColumns(ss);
    // Fixture row counts: Tech 4, Gym & Sport 2, Home Things 1, Books 4 = 11 rows.
    const ids = ITEM_TABS.flatMap((n) => {
      const t = ss.getTab(n) as FakeTab;
      const c = colOf(t, "ID");
      return t.grid.slice(headerRow(t) + 1).map((r) => r[c - 1]);
    });
    expect(ids).toEqual(Array.from({ length: 11 }, (_, i) => `I-${String(i + 1).padStart(4, "0")}`));
  });

  it("skips fully empty rows and writes nothing for them", () => {
    const ss = real();
    const tech = ss.getTab("Tech") as FakeTab;
    tech.grid.splice(3, 0, [], [null, null]);
    addIdColumns(ss);
    const idCol = colOf(tech, "ID");
    expect(tech.grid[3]![idCol - 1] ?? null).toBeNull();
    expect(tech.grid[4]![idCol - 1] ?? null).toBeNull();
  });

  it("sets Quantity 1 where blank and keeps an existing quantity", () => {
    const ss = real();
    const tech = ss.getTab("Tech") as FakeTab;
    const qtyCol = tech.grid[1]!.length + 2;
    tech.setCell(2, qtyCol - 1, "ID"); // header present...
    tech.setCell(2, qtyCol, "Quantity");
    tech.setCell(3, qtyCol, 5); // first data row already has quantity 5
    addIdColumns(ss);
    expect(tech.grid[2]![qtyCol - 1]).toBe(5);
    expect(tech.grid[3]![qtyCol - 1]).toBe(1);
  });

  it("returns counts: columns, IDs and quantities", () => {
    const r = addIdColumns(real());
    expect(r).toEqual({ columnsAdded: 8, idsAssigned: 11, quantitiesSet: 11 });
  });

  it("logs counts only, no item names or people", () => {
    const lines: string[] = [];
    addIdColumns(real(), { log: (l) => lines.push(l) });
    const out = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(out).not.toContain("Echo Dot");
    expect(out).not.toContain("Asha");
  });
});

describe("addIdColumns: idempotent", () => {
  it("a second run changes nothing and reports zeros", () => {
    const ss = real();
    addIdColumns(ss);
    const snap = ss.snapshot();
    expect(addIdColumns(ss)).toEqual({ columnsAdded: 0, idsAssigned: 0, quantitiesSet: 0 });
    expect(ss.snapshot()).toBe(snap);
  });

  it("keeps existing IDs and gives a new row the next free one", () => {
    const ss = real();
    addIdColumns(ss);
    const first = idsByName(ss);
    const home = ss.getTab("Home Things") as FakeTab;
    const nameCol = colOf(home, "Item");
    const newRow = [] as string[];
    newRow[nameCol - 1] = "New lamp";
    home.appendRow(newRow);
    const r = addIdColumns(ss);
    expect(r.idsAssigned).toBe(1);
    const second = idsByName(ss);
    for (const [k, v] of Object.entries(first)) expect(second[k]).toBe(v);
    expect(second["Home Things/New lamp"]).toBe("I-0012");
  });

  it("never hands out an ID that is already on a row, wherever it sits", () => {
    const ss = real();
    const tech = ss.getTab("Tech") as FakeTab;
    const idCol = tech.grid[1]!.length + 1;
    tech.setCell(2, idCol, "ID");
    tech.setCell(3, idCol, "I-0002"); // second data row of the sheet already numbered
    addIdColumns(ss);
    const all = Object.values(idsByName(ss));
    expect(new Set(all).size).toBe(all.length);
    expect(tech.grid[2]![idCol - 1]).toBe("I-0002");
  });
});

describe("addIdColumns: Person is never touched (D-035)", () => {
  it("leaves every Person cell exactly as it was, even hostile ones", () => {
    const ss = real();
    const tech = ss.getTab("Tech") as FakeTab;
    tech.setCell(3, colOf(tech, "Person"), "Call +91 90000 00077");
    const before = personColumn(ss);
    addIdColumns(ss);
    expect(personColumn(ss)).toEqual(before);
  });

  it("never writes to the Person column or writes a Person value anywhere", () => {
    const ss = real();
    const written: { tab: string; col: number; value: unknown }[] = [];
    for (const t of ss.getTabs() as FakeTab[]) {
      const orig = t.setCell.bind(t);
      t.setCell = (row, col, value) => { written.push({ tab: t.name, col, value }); orig(row, col, value); };
    }
    const personCols = Object.fromEntries(ITEM_TABS.map((n) => [n, colOf(ss.getTab(n) as FakeTab, "Person")]));
    addIdColumns(ss);
    expect(written.length).toBeGreaterThan(0);
    for (const w of written) expect(w.col).not.toBe(personCols[w.tab]);
    const names = ["Asha Testperson", "Ravi Samplename", "Meena Fixture"];
    for (const w of written) expect(names).not.toContain(w.value);
  });

  it("does not need Person values to be scrubbed (hostile names do not stop it)", () => {
    const ss = real(); // fixture Person cells include a formula string and real-looking names
    expect(() => addIdColumns(ss)).not.toThrow();
  });
});

describe("addIdColumns matches migrate's IDs (the published photos depend on it)", () => {
  it("gives every item the same ID that migrate gives it on a scrubbed copy of the same fixture", () => {
    const staged = buildStagingTitled(); // BUILD COPY
    scrubStaging(staged);
    migrate(staged, { randomBytes: counterRandom().fn, now: () => NOW });

    const realCopy = real(); // unscrubbed, no BUILD COPY
    addIdColumns(realCopy);

    const expected = idsByName(staged);
    expect(Object.keys(expected)).toHaveLength(11);
    expect(idsByName(realCopy)).toEqual(expected);
  });

  it("agrees with migrate on the column positions of ID and Quantity too", () => {
    const staged = buildStagingTitled();
    scrubStaging(staged);
    migrate(staged, { randomBytes: counterRandom().fn, now: () => NOW });
    const realCopy = real();
    addIdColumns(realCopy);
    for (const n of ITEM_TABS) {
      expect(colOf(realCopy.getTab(n) as FakeTab, "ID")).toBe(colOf(staged.getTab(n) as FakeTab, "ID"));
      expect(colOf(realCopy.getTab(n) as FakeTab, "Quantity")).toBe(colOf(staged.getTab(n) as FakeTab, "Quantity"));
    }
  });
});
