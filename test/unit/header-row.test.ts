import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, scrubStaging } from "../../src/api/migrate";
import type { CellValue, Tab } from "../../src/api/sheet";
import { FakeSpreadsheet, FakeTab, counterRandom } from "../fixtures/fake-sheet";
import { SELLER_NUMBER, buildStaging } from "../fixtures/staging-fixture";
import { DATA_ROW_NOTE, TITLE_TEXT, buildStagingTitled } from "../fixtures/title-row-fixture";

// D-027: the header row of an item tab or Template is the first of the top 5
// rows with a cell exactly "Person" (trimmed). The live build copy has it on
// row 2, under a title row. Rows above it are never data (not Person values, not
// items, no IDs, no claims) and are scanned in full for phone numbers. Data rows
// are below it and all writes use real sheet row numbers. ID and Quantity go in
// the detected header row. Claims, Bookings, To do and Sold keep row-1 headers.

const NOW = "2026-11-05T10:00:00.000Z";
const PHONE_LIKE = /\+?\d(?:[\s-]?\d){9,}/;
const ITEM_TABS = ["Tech", "Gym & Sport", "Home Things", "Books"];
const SYSTEM_TABS = ["Claims", "Bookings", "To do", "Sold"];
const SCRUBBED = /^Test Person \d+$/;

afterEach(() => vi.restoreAllMocks());

const tabOf = (ss: FakeSpreadsheet, name: string) => {
  const t = ss.getTab(name);
  if (!t) throw new Error(`missing tab ${name}`);
  return t;
};
/** The scrub, with its log lines collected (counts only). */
function scrub(ss: FakeSpreadsheet) {
  const logs: string[] = [];
  const res = scrubStaging(ss, { log: (l) => logs.push(l) });
  return { res, logs };
}
/** Migrate the way the live run does: after a scrub, with the preflight ON. */
function migrateScrubbed(ss: FakeSpreadsheet) {
  scrubStaging(ss);
  return migrate(ss, { randomBytes: counterRandom().fn, now: () => NOW });
}
/** 0-based index of the first row (within `limit`) with a cell exactly "Person". */
function headerIdx(tab: Tab): number {
  return tab.getGrid().findIndex((r) => r.some((c) => typeof c === "string" && c.trim() === "Person"));
}
/** Cells of the data rows (below the header) keyed by header name, with real sheet row. */
function dataRows(tab: Tab, headerRow: number) {
  const g = tab.getGrid();
  const head = g[headerRow - 1] ?? [];
  return g.slice(headerRow).map((cells, i) => ({
    row: headerRow + 1 + i,
    rec: Object.fromEntries(head.map((h, c) => [String(h), cells[c] ?? null])) as Record<string, CellValue>,
  }));
}

describe("fixture guard", () => {
  it("builds item tabs and Template with the header on row 2 and a title on row 1", () => {
    const ss = buildStagingTitled();
    for (const n of [...ITEM_TABS, "Template"]) {
      expect(headerIdx(tabOf(ss, n)), n).toBe(1);
      expect(JSON.stringify(tabOf(ss, n).getGrid()[0]), n).not.toContain('"Person"');
    }
  });
});

describe("scrubStaging with the header on row 2 (D-027 rules 1 and 4)", () => {
  it("replaces every Person value in every item tab with a Test Person N name", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    for (const n of ["Tech", "Gym & Sport", "Books"]) {
      const tab = tabOf(ss, n);
      const col = tab.getGrid()[1]!.indexOf("Person");
      const originals = tabOf(buildStagingTitled(), n).getGrid().slice(2).map((r) => r[col]);
      tab.getGrid().slice(2).forEach((r, i) => {
        if (originals[i] == null) expect(r[col] ?? null, `${n} row ${i + 3}`).toBeNull();
        else expect(String(r[col]), `${n} row ${i + 3}`).toMatch(SCRUBBED);
      });
    }
  });

  it("uses distinct, consecutive Test Person numbers across tabs", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    const names = ["Tech", "Gym & Sport", "Books"].flatMap((n) => {
      const tab = tabOf(ss, n);
      const col = tab.getGrid()[1]!.indexOf("Person");
      return tab.getGrid().slice(2).map((r) => r[col]).filter((v) => v != null) as string[];
    });
    expect(names.map((s) => Number(s.replace("Test Person ", ""))).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reports the right peopleReplaced count and no tab without a Person column", () => {
    // Same fixture people as the row-1 case: Tech 3 + Gym 1 + Books 2.
    const { res } = scrub(buildStagingTitled());
    expect(res.peopleReplaced).toBe(6);
    expect(res.tabs["Tech"]!.peopleReplaced).toBe(3);
    expect(res.tabs["Gym & Sport"]!.peopleReplaced).toBe(1);
    expect(res.tabs["Books"]!.peopleReplaced).toBe(2);
    expect(res.tabsWithoutPerson).toEqual([]);
  });

  it("does not log the no-Person WARNING when every tab has its header on row 2", () => {
    const { logs } = scrub(buildStagingTitled());
    expect(logs.join("\n")).not.toMatch(/no Person column/);
  });

  it("finds Person by name in Books (swapped columns) under a title row", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    const books = dataRows(tabOf(ss, "Books"), 2);
    expect(String(books.find((r) => r.rec["Item"] === "Night Garden")!.rec["Person"])).toMatch(SCRUBBED);
    expect(String(books.find((r) => r.rec["Item"] === "Slow Rivers")!.rec["Person"])).toMatch(SCRUBBED);
  });

  it("matches the Person header after trimming whitespace", () => {
    const ss = buildStagingTitled();
    const gym = tabOf(ss, "Gym & Sport") as FakeTab;
    gym.setCell(2, gym.getGrid()[1]!.indexOf("Person") + 1, "  Person ");
    const { res } = scrub(ss);
    expect(res.tabs["Gym & Sport"]!.peopleReplaced).toBe(1);
  });

  it("leaves every other column of the data rows unchanged", () => {
    const before = buildStagingTitled();
    const ss = buildStagingTitled();
    scrub(ss);
    for (const n of ["Tech", "Gym & Sport", "Books"]) {
      const strip = (s: FakeSpreadsheet) => {
        const tab = tabOf(s, n);
        const c = tab.getGrid()[1]!.indexOf("Person");
        return tab.getGrid().slice(2).map((r) => r.filter((_, i) => i !== c));
      };
      expect(strip(ss), n).toEqual(strip(before));
    }
  });
});

describe("scrubStaging rows above the header (D-027 rule 3)", () => {
  it("removes the seller's number from a row-1 title", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    const row1 = tabOf(ss, "Tech").getGrid()[0]!;
    expect(row1.map((c) => String(c ?? "")).join("|")).not.toMatch(PHONE_LIKE);
    expect(JSON.stringify(row1)).not.toContain(SELLER_NUMBER);
  });

  it("removes a number held in a row-1 formula and a row-1 link", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    const tech = tabOf(ss, "Tech");
    expect(tech.getFormulas().filter((f) => f.row === 1)).toEqual([]);
    expect(tech.getLinks().filter((l) => l.row === 1)).toEqual([]);
  });

  it("keeps the non-number text of a title row", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    expect(String(tabOf(ss, "Tech").getGrid()[0]![0])).toContain("Tech - WhatsApp");
    expect(tabOf(ss, "Gym & Sport").getGrid()[0]).toEqual([TITLE_TEXT]);
  });

  it("scans a title cell that is not in the first column", () => {
    const ss = buildStagingTitled();
    const gym = tabOf(ss, "Gym & Sport") as FakeTab;
    // A number in a non-first cell of Gym's title row; the header is still row 2.
    gym.setCell(1, 3, `ring ${SELLER_NUMBER}`);
    scrub(ss);
    expect(String(gym.getGrid()[0]![2] ?? "")).not.toMatch(PHONE_LIKE);
  });

  it("removes a number from a header-row cell on row 2 as well", () => {
    const ss = buildStagingTitled();
    tabOf(ss, "Tech").setCell(2, 10, `Link (WhatsApp ${SELLER_NUMBER})`);
    scrub(ss);
    expect(String(tabOf(ss, "Tech").getGrid()[1]![9])).not.toMatch(PHONE_LIKE);
  });

  it("does not touch a phone-like string in a data-row, non-Person cell", () => {
    // Same as row-1 behaviour: below the header only Person cells change.
    const ss = buildStagingTitled();
    scrub(ss);
    expect(tabOf(ss, "Tech").getGrid()[2]![7]).toBe(DATA_ROW_NOTE);
  });

  it("never treats title cells as Person values (Books has text in Person and Status columns)", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    const row1 = tabOf(ss, "Books").getGrid()[0]!;
    expect(row1.slice(0, 2)).toEqual(["Books - full list", "Spring 2026"]);
    expect(JSON.stringify(row1)).not.toMatch(/Test Person/);
  });

  it("does not count title rows in peopleReplaced", () => {
    // A title cell sitting in the Person column of Gym must not be replaced or counted.
    const ss = buildStagingTitled();
    const gym = tabOf(ss, "Gym & Sport") as FakeTab;
    const col = gym.getGrid()[1]!.indexOf("Person");
    gym.setCell(1, col + 1, "Sale owner");
    const { res } = scrub(ss);
    expect(res.tabs["Gym & Sport"]!.peopleReplaced).toBe(1);
    expect(gym.getGrid()[0]![col]).toBe("Sale owner");
  });

  it("leaves no phone-like string above or on the header row of any tab", () => {
    const ss = buildStagingTitled();
    scrub(ss);
    for (const n of [...ITEM_TABS, "Template"]) {
      for (const r of tabOf(ss, n).getGrid().slice(0, 2)) {
        for (const c of r) expect(String(c ?? ""), n).not.toMatch(PHONE_LIKE);
      }
    }
  });
});

describe("scrubStaging header not found in the top 5 rows (D-027 rule 2)", () => {
  it("treats a tab whose Person header is on row 6 as having no Person column", () => {
    const ss = buildStagingTitled({ "Home Things": 6 });
    const { res, logs } = scrub(ss);
    expect(res.tabsWithoutPerson).toEqual(["Home Things"]);
    expect(logs.join("\n")).toMatch(/WARNING no Person column found.*"Home Things"/);
  });

  it("still scans every cell of that tab for numbers", () => {
    const ss = buildStagingTitled({ "Home Things": 6 });
    const home = tabOf(ss, "Home Things") as FakeTab;
    home.setCell(8, 2, `Call ${SELLER_NUMBER}`);
    scrub(ss);
    expect(home.getGrid().flat().map((c) => String(c ?? "")).join("|")).not.toMatch(PHONE_LIKE);
  });

  it("accepts a header on row 5, the last row of the window", () => {
    const gym = buildStagingTitled({ "Gym & Sport": 5 });
    expect(headerIdx(tabOf(gym, "Gym & Sport"))).toBe(4);
    const { res } = scrub(gym);
    expect(res.tabs["Gym & Sport"]!.peopleReplaced).toBe(1);
    expect(res.tabsWithoutPerson).toEqual([]);
  });
});

describe("scrubStaging mixed header rows (no regression for row 1)", () => {
  it("handles a tab with its header on row 1 next to tabs with it on row 2", () => {
    const ss = buildStagingTitled({ "Gym & Sport": 1 });
    const { res, logs } = scrub(ss);
    expect(res.peopleReplaced).toBe(6);
    expect(res.tabsWithoutPerson).toEqual([]);
    expect(logs.join("\n")).not.toMatch(/no Person column/);
    const gym = tabOf(ss, "Gym & Sport").getGrid();
    expect(String(gym[2]![gym[0]!.indexOf("Person")])).toMatch(SCRUBBED);
  });

  it("still scrubs the original all-row-1 fixture (control)", () => {
    const { res } = scrub(buildStaging());
    expect(res.peopleReplaced).toBe(6);
    expect(res.tabsWithoutPerson).toEqual([]);
  });
});

describe("migrate on a scrubbed copy with the header on row 2", () => {
  it("passes the preflight (no refusal, no 'has no ... column' error)", () => {
    expect(() => migrateScrubbed(buildStagingTitled())).not.toThrow();
  });

  it("writes ID and Quantity into the header row (row 2), after the existing columns", () => {
    const ss = buildStagingTitled();
    migrateScrubbed(ss);
    for (const n of ITEM_TABS) {
      const g = tabOf(ss, n).getGrid();
      expect(g[1]!.slice(10), n).toEqual(["ID", "Quantity"]);
      expect(g[1]!.slice(0, 10), n).toHaveLength(10);
    }
  });

  it("writes nothing into row 1 of any item tab or Template", () => {
    const ss = buildStagingTitled();
    scrubStaging(ss);
    const row1 = (n: string) => JSON.stringify(tabOf(ss, n).getGrid()[0]);
    const before = [...ITEM_TABS, "Template"].map(row1);
    migrate(ss, { randomBytes: counterRandom().fn, now: () => NOW });
    expect([...ITEM_TABS, "Template"].map(row1)).toEqual(before);
  });

  it("does not read title rows as items (no Status error) and gives them no ID", () => {
    // Books row 1 has text in its Status column; Tech row 1 in Status too if the title were data.
    const ss = buildStagingTitled();
    expect(() => migrateScrubbed(ss)).not.toThrow();
    expect(tabOf(ss, "Books").getGrid()[0]!.length).toBe(2);
    expect(tabOf(ss, "Gym & Sport").getGrid()[0]).toEqual([TITLE_TEXT]);
  });

  it("assigns a unique ID and quantity 1 to every data row, at the real sheet row", () => {
    const ss = buildStagingTitled();
    const res = migrateScrubbed(ss);
    const ids: string[] = [];
    for (const n of ITEM_TABS) {
      const rows = dataRows(tabOf(ss, n), 2);
      expect(rows.length, n).toBeGreaterThan(0);
      for (const { row, rec } of rows) {
        expect(String(rec["ID"] ?? ""), `${n} row ${row}`).toMatch(/^I-\d{4}$/);
        expect(rec["Quantity"], `${n} row ${row}`).toBe(1);
        ids.push(String(rec["ID"]));
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(res.idsAssigned).toBe(ids.length);
    expect(res.quantitiesSet).toBe(ids.length);
  });

  it("does not grow the grid with phantom rows (title rows keep their width)", () => {
    const ss = buildStagingTitled();
    const heights = ITEM_TABS.map((n) => tabOf(ss, n).getGrid().length);
    migrateScrubbed(ss);
    expect(ITEM_TABS.map((n) => tabOf(ss, n).getGrid().length)).toEqual(heights);
  });

  it("creates one claim per Reserved or Sold row, pointing at that row's ID and item", () => {
    const ss = buildStagingTitled();
    const res = migrateScrubbed(ss);
    const claims = dataRows(tabOf(ss, "Claims"), 1).map((r) => r.rec);
    const expected = ITEM_TABS.flatMap((n) =>
      dataRows(tabOf(ss, n), 2).filter((r) => r.rec["Status"] !== "Available" && r.rec["Person"] != null),
    );
    // Hand count: Tech 3 (Tripod, Camera, Lamp) + Gym 1 (Dumbbell pair) + Books 2.
    expect(expected).toHaveLength(6);
    expect(res.claimsCreated).toBe(6);
    expect(claims).toHaveLength(6);
    for (const { row, rec } of expected) {
      const claim = claims.find((c) => c["Item ID"] === rec["ID"]);
      expect(claim, `row ${row} ${String(rec["Item"])}`).toBeDefined();
      expect(claim!["Item"]).toBe(rec["Item"]);
      expect(claim!["State"]).toBe(rec["Status"] === "Sold" ? "sold" : "active");
    }
  });

  it("copies the right price into the sold claim of a swapped-column tab", () => {
    const ss = buildStagingTitled();
    migrateScrubbed(ss);
    const claims = dataRows(tabOf(ss, "Claims"), 1).map((r) => r.rec);
    const slow = dataRows(tabOf(ss, "Books"), 2).find((r) => r.rec["Item"] === "Slow Rivers")!;
    // Slow Rivers is Sold at 120 in the fixture.
    expect(claims.find((c) => c["Item ID"] === slow.rec["ID"])!["Sold price"]).toBe(120);
  });

  it("keeps the Claims, Bookings, To do and Sold headers on row 1", () => {
    const ss = buildStagingTitled();
    migrateScrubbed(ss);
    for (const n of SYSTEM_TABS) {
      const first = tabOf(ss, n).getGrid()[0]!;
      expect(first.length, n).toBeGreaterThan(0);
      expect(first[0], n).toMatch(/^(Claim ID|Booking ID)$/);
    }
    expect(tabOf(ss, "Claims").getGrid()[0]![2]).toBe("Item ID");
  });

  it("is idempotent: a second run changes nothing", () => {
    const ss = buildStagingTitled();
    migrateScrubbed(ss);
    const before = ss.snapshot();
    const again = migrate(ss, { randomBytes: counterRandom(99).fn, now: () => NOW });
    expect(ss.snapshot()).toBe(before);
    expect(again).toMatchObject({ columnsAdded: 0, idsAssigned: 0, quantitiesSet: 0, claimsCreated: 0 });
  });

  it("refuses an unscrubbed Person under a row-2 header (preflight reads the right row)", () => {
    const ss = buildStagingTitled();
    expect(() => migrate(ss, { randomBytes: counterRandom().fn, now: () => NOW })).toThrow(/run scrubStaging first/);
  });
});

describe("migrate Template with the header on row 2", () => {
  it("adds ID and Quantity to Template's row 2, not row 1", () => {
    const ss = buildStagingTitled();
    migrateScrubbed(ss);
    const g = tabOf(ss, "Template").getGrid();
    expect(g[1]!.slice(10)).toEqual(["ID", "Quantity"]);
    expect(g[0]).toEqual([TITLE_TEXT]);
  });

  it("sets quantity 1 on the example row at its real row (row 3) and gives it no ID", () => {
    const ss = buildStagingTitled();
    migrateScrubbed(ss);
    const g = tabOf(ss, "Template").getGrid();
    expect(g[2]![11]).toBe(1);
    expect(g[2]![10] ?? null).toBeNull();
  });
});

describe("migrate header not found in the top 5 rows", () => {
  it("refuses, naming the tab, and changes nothing", () => {
    const ss = buildStagingTitled({ "Home Things": 6 });
    scrubStaging(ss);
    const before = ss.snapshot();
    expect(() => migrate(ss, { randomBytes: counterRandom().fn, now: () => NOW })).toThrow(/Home Things.*has no/);
    expect(ss.snapshot()).toBe(before);
  });
});

describe("migrate mixed header rows (no regression for row 1)", () => {
  it("migrates a row-1-header tab and row-2-header tabs in one run", () => {
    const ss = buildStagingTitled({ "Gym & Sport": 1 });
    expect(() => migrateScrubbed(ss)).not.toThrow();
    expect(tabOf(ss, "Gym & Sport").getGrid()[0]!.slice(10)).toEqual(["ID", "Quantity"]);
    expect(tabOf(ss, "Tech").getGrid()[1]!.slice(10)).toEqual(["ID", "Quantity"]);
    const gym = dataRows(tabOf(ss, "Gym & Sport"), 1);
    for (const { rec } of gym) expect(String(rec["ID"] ?? "")).toMatch(/^I-\d{4}$/);
  });
});
