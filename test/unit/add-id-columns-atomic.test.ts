// D-036.3 and D-036.4: addIdColumns checks all four item tabs before it writes
// anything, so a bad tab never leaves the sheet half-numbered; and a later run
// fills only rows that have no ID. Synthetic data only.
//
// Mutation note: QA's mutant deleted the `for (const n of ITEM_TABS) checkTab(...)`
// pre-check loop. The bad tab is tried in every position, including the last, so
// that without the loop the earlier tabs get written before the throw and the
// before/after snapshot differs.
import { describe, expect, it } from "vitest";
import { addIdColumns } from "../../src/api/add-id-columns";
import type { FakeSpreadsheet, FakeTab } from "../fixtures/fake-sheet";
import { buildStagingTitled } from "../fixtures/title-row-fixture";

const ITEM_TABS = ["Tech", "Gym & Sport", "Home Things", "Books"];
const real = (): FakeSpreadsheet => buildStagingTitled({}, "Synthetic real sheet");

describe("addIdColumns checks every tab before writing (D-036.3)", () => {
  it.each(ITEM_TABS)("a missing %s tab throws naming it and writes nothing to any tab", (name) => {
    const ss = real();
    ss.tabs = ss.tabs.filter((t) => t.name !== name);
    const before = ss.snapshot();
    expect(() => addIdColumns(ss)).toThrow(new RegExp(name.replace(/[&]/g, "\\$&")));
    expect(ss.snapshot()).toBe(before);
  });

  it.each(ITEM_TABS)("a %s tab with no header row throws naming it and writes nothing to any tab", (name) => {
    const ss = real();
    // Rows exist but none says "Person", so no header row can be found.
    (ss.getTab(name) as FakeTab).grid = [["Just a title"], ["Thing", "Cost"], ["Lamp", 5]];
    const before = ss.snapshot();
    expect(() => addIdColumns(ss)).toThrow(new RegExp(name.replace(/[&]/g, "\\$&")));
    expect(ss.snapshot()).toBe(before);
  });

  it("an entirely empty tab also throws and writes nothing", () => {
    const ss = real();
    (ss.getTab("Books") as FakeTab).grid = [];
    const before = ss.snapshot();
    expect(() => addIdColumns(ss)).toThrow(/Books/);
    expect(ss.snapshot()).toBe(before);
  });

  it("logs nothing when it throws before any write", () => {
    const ss = real();
    ss.tabs = ss.tabs.filter((t) => t.name !== "Books");
    const lines: string[] = [];
    expect(() => addIdColumns(ss, { log: (l) => lines.push(l) })).toThrow();
    expect(lines).toEqual([]);
  });

  it("after the problem tab is fixed, the next run numbers the whole sheet normally", () => {
    const ss = real();
    const books = ss.getTab("Books") as FakeTab;
    const saved = books.grid;
    books.grid = [["Just a title"], ["Thing"]];
    expect(() => addIdColumns(ss)).toThrow();
    books.grid = saved;
    expect(addIdColumns(ss)).toMatchObject({ idsAssigned: 11, quantitiesSet: 11 });
  });
});

describe("addIdColumns on a later run fills only rows with no ID (D-036.4)", () => {
  const colOf = (t: FakeTab, name: string): number => t.grid[1]!.indexOf(name) + 1;

  it("keeps every existing ID and numbers only the new rows, after the highest in use", () => {
    const ss = real();
    addIdColumns(ss);
    const idsOf = (): Record<string, unknown[]> =>
      Object.fromEntries(ITEM_TABS.map((n) => {
        const t = ss.getTab(n) as FakeTab;
        const c = colOf(t, "ID");
        return [n, t.grid.slice(2).map((r) => r[c - 1] ?? null)];
      }));
    const before = idsOf();

    // The seller types a new item into two different tabs (name column found by header).
    for (const n of ["Tech", "Home Things"]) {
      const t = ss.getTab(n) as FakeTab;
      const row: string[] = [];
      row[colOf(t, "Item") - 1] = `New ${n}`;
      t.appendRow(row);
    }
    const result = addIdColumns(ss);
    expect(result).toEqual({ columnsAdded: 0, idsAssigned: 2, quantitiesSet: 2 });

    const after = idsOf();
    for (const n of ITEM_TABS) expect(after[n]!.slice(0, before[n]!.length)).toEqual(before[n]);
    const fresh = [after["Tech"]!.at(-1), after["Home Things"]!.at(-1)];
    // 11 rows were numbered I-0001..I-0011; new rows continue in tab order.
    expect(fresh).toEqual(["I-0012", "I-0013"]);
  });
});
