import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, scrubStaging } from "../../src/api/migrate";
import type { FakeTab } from "../fixtures/fake-sheet";
import { FakeSpreadsheet, counterRandom } from "../fixtures/fake-sheet";
import { BUYER_NAMES, FORMULA_NAME, ITEM_HEADERS, ORIGINALS, buildStaging } from "../fixtures/staging-fixture";

// S-03 QA fix round: B1 (Claims/Bookings), B2 (number forms), B3 (formulas and
// links), B4 (fail loud), plus the surviving mutants. Synthetic data only.

afterEach(() => vi.restoreAllMocks());

const TITLE = "A44 Garage Sale BUILD COPY";
const SYNTHETIC = "Test Person"; // what the scrub writes: `Test Person <n>`
const itemRow = (item: string, status: string, person: string | null) =>
  [item, "BrandX", "Cat", 100, "Now", status, person, null, null, null];

/** A sheet with only a README (the rows given) and one item tab. */
function mini(readme: unknown[][], tech: unknown[][] = [[...ITEM_HEADERS]]): FakeSpreadsheet {
  const ss = new FakeSpreadsheet(TITLE);
  ss.withTab("README", readme as never);
  ss.withTab("Tech", tech as never);
  return ss;
}
const cell = (ss: FakeSpreadsheet, tab: string, row: number, col: number) =>
  ss.getTab(tab)!.getGrid()[row - 1]?.[col - 1];
/** Digits left in a cell after folding full-width digits to ASCII. */
const digitsIn = (v: unknown) => String(v ?? "").normalize("NFKC").replace(/\D/g, "");
const fullWidth = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));

describe("scrub: phone numbers stored as numbers (B2)", () => {
  it.each([919000000001, 9000000001])("removes the number %s from a numeric README cell", (n) => {
    const ss = mini([["Notes"], [n]]);
    const res = scrubStaging(ss);
    expect(String(cell(ss, "README", 2, 1))).not.toContain("9000000001");
    expect(res.numbersRemoved).toBe(1);
  });

  it("removes a numeric header cell and still finds the other headers by name", () => {
    const ss = mini([["Notes"]]);
    ss.getTab("Tech")!.setCell(1, 10, 919000000001);
    scrubStaging(ss);
    const head = ss.getTab("Tech")!.getGrid()[0]!;
    expect(String(head[9])).not.toContain("9000000001");
    expect(head).toContain("Person");
  });

  it("leaves a 9-digit number cell alone (not a phone number)", () => {
    const ss = mini([["Notes"], [900000001]]);
    const res = scrubStaging(ss);
    expect(cell(ss, "README", 2, 1)).toBe(900000001);
    expect(res.numbersRemoved).toBe(0);
  });
});

describe("scrub: phone number layouts (B2)", () => {
  // Layouts the pattern missed (QA) and layouts it already caught (must keep).
  const missed: Record<string, string> = {
    "double space between halves": "Call 90000  00001",
    "spaced hyphen": "Call 90000 - 00001",
    "dot separator": "Call 90000.00001",
    "slash separator": "Call 90000/00001",
    "en dash": "Call 90000–00001",
    "bracketed group": "Call +91 (90000) 00001",
    "full-width digits": `Call ${fullWidth("9000000001")}`,
  };
  const caught: Record<string, string> = {
    "plus 91 with hyphen": "Call +91-90000 00001",
    "leading-zero 11 digits, spaced": "Call 0 90000 " + "00001",
    "leading-zero 11 digits": "Call 0" + "9000000001",
    "bracketed country code": "Call (+91) 90000 00001",
    "wa.me link": "https://wa.me/919000000001",
    "wa.me link with plus and hyphens": "https://wa.me/+91-90000-00001",
    "api.whatsapp.com link": "https://api.whatsapp.com/send?phone=919000000001",
    "non-breaking spaces": "Call 90000 00001",
    "plain spaced": "WhatsApp +91 90000 00001",
    "unspaced": "Call +919000000001",
  };
  it.each(Object.entries({ ...missed, ...caught }))("removes the number in: %s", (_label, text) => {
    const ss = mini([["Notes"], [text]]);
    scrubStaging(ss);
    expect(digitsIn(cell(ss, "README", 2, 1)).length).toBeLessThan(10);
    expect(String(cell(ss, "README", 2, 1))).not.toContain("00001");
  });

  it("leaves a 9-digit run in text alone", () => {
    const ss = mini([["Notes"], ["Order 900000001 packed"]]);
    scrubStaging(ss);
    expect(cell(ss, "README", 2, 1)).toBe("Order 900000001 packed");
  });
});

describe("scrub: numbers hidden in formulas and links (B3)", () => {
  const HYPER = '=HYPERLINK("https://wa.me/919000000001","Message me")';

  it("turns a README formula that holds a number into plain text without the number", () => {
    const ss = mini([["Notes"], ["Message me"]]);
    (ss.getTab("README") as FakeTab).setFormula(2, 1, HYPER);
    const res = scrubStaging(ss);
    const readme = ss.getTab("README") as FakeTab;
    expect(readme.getFormulas()).toEqual([]);
    expect(typeof cell(ss, "README", 2, 1)).toBe("string");
    expect(JSON.stringify(readme.getGrid()) + JSON.stringify(readme.getLinks())).not.toContain("9000000001");
    expect(res.numbersRemoved).toBe(1);
  });

  it("does the same for a formula in a header cell", () => {
    const ss = mini([["Notes"]]);
    const tech = ss.getTab("Tech") as FakeTab;
    tech.setFormula(1, 9, HYPER);
    scrubStaging(ss);
    expect(tech.getFormulas()).toEqual([]);
    expect(JSON.stringify(tech.getGrid())).not.toContain("9000000001");
    expect(tech.getGrid()[0]).toContain("Person");
  });

  it("removes a rich-text link whose URL holds a number from a README cell", () => {
    const ss = mini([["Notes"], ["Message me"]]);
    (ss.getTab("README") as FakeTab).setLink(2, 1, "https://wa.me/919000000001");
    const res = scrubStaging(ss);
    expect((ss.getTab("README") as FakeTab).getLinks()).toEqual([]);
    expect(res.numbersRemoved).toBe(1);
  });

  it("removes a rich-text link whose URL holds a number from a header cell", () => {
    const ss = mini([["Notes"]]);
    const tech = ss.getTab("Tech") as FakeTab;
    tech.setLink(1, 10, "https://api.whatsapp.com/send?phone=919000000001");
    scrubStaging(ss);
    expect(tech.getLinks()).toEqual([]);
  });

  it("leaves links and formulas that hold no number untouched", () => {
    const ss = mini([["Notes"], ["Our site"], ["=1+1"]]);
    const readme = ss.getTab("README") as FakeTab;
    readme.setLink(2, 1, "https://example.org/sale");
    readme.setFormula(3, 1, "=1+1");
    scrubStaging(ss);
    expect(readme.getLinks()).toEqual([{ row: 2, col: 1, url: "https://example.org/sale" }]);
    expect(readme.getFormulas()).toEqual([{ row: 3, col: 1, formula: "=1+1" }]);
  });

  it("leaves no trace of the number anywhere in the sheet snapshot", () => {
    const ss = buildStaging();
    const readme = ss.getTab("README") as FakeTab;
    readme.setFormula(3, 1, HYPER);
    readme.setLink(4, 1, "https://wa.me/919000000001");
    scrubStaging(ss);
    expect(ss.snapshot()).not.toContain("9000000001");
  });
});

describe("scrub: Claims and Bookings tabs (B1)", () => {
  /** Post-migrate state built directly: migrate an unscrubbed copy (guard skipped). */
  function postMigrate(): FakeSpreadsheet {
    const ss = buildStaging();
    migrate(ss, { randomBytes: counterRandom().fn, now: () => "2026-11-03T10:00:00.000Z", allowUnscrubbed: true });
    return ss;
  }
  const col = (ss: FakeSpreadsheet, tab: string, header: string) => ss.getTab(tab)!.getGrid()[0]!.indexOf(header);
  const column = (ss: FakeSpreadsheet, tab: string, header: string) => {
    const c = col(ss, tab, header);
    return ss.getTab(tab)!.getGrid().slice(1).map((r) => r[c] ?? null);
  };

  it("replaces every Name in Claims and Bookings so no original name remains anywhere (QA reproduction)", () => {
    const ss = postMigrate();
    expect(column(ss, "Claims", "Name").length).toBeGreaterThan(0); // fixture guard
    scrubStaging(ss);
    const everything = JSON.stringify(ss.getTabs().map((t) => t.getGrid())) + ss.snapshot();
    for (const name of [...BUYER_NAMES, FORMULA_NAME]) expect(everything).not.toContain(name);
  });

  it("gives every non-blank Name in Claims and Bookings the scrub's Test Person format", () => {
    const ss = postMigrate();
    scrubStaging(ss);
    for (const tab of ["Claims", "Bookings"]) {
      for (const n of column(ss, tab, "Name")) expect(String(n)).toMatch(/^Test Person \d+$/);
    }
  });

  it("blanks every Number in Claims and Bookings", () => {
    const ss = postMigrate();
    for (const tab of ["Claims", "Bookings"]) {
      const c = col(ss, tab, "Number") + 1;
      for (let r = 2; r <= ss.getTab(tab)!.getGrid().length; r++) ss.getTab(tab)!.setCell(r, c, "+91 90000 00002");
    }
    scrubStaging(ss);
    for (const tab of ["Claims", "Bookings"]) {
      for (const n of column(ss, tab, "Number")) expect(n === null || n === "").toBe(true);
    }
    expect(ss.snapshot()).not.toContain("90000 00002");
  });

  it("blanks a numeric Number cell too", () => {
    const ss = postMigrate();
    ss.getTab("Claims")!.setCell(2, col(ss, "Claims", "Number") + 1, 919000000002);
    scrubStaging(ss);
    expect(column(ss, "Claims", "Number")[0] ?? "").toBe("");
  });

  it("finds Name and Number by header, not position", () => {
    const ss = postMigrate();
    const claims = ss.getTab("Claims") as FakeTab;
    // Swap the Name and Number header cells and their data.
    const n = col(ss, "Claims", "Name"), m = col(ss, "Claims", "Number");
    claims.grid.forEach((r) => {
      const tmp = r[n] ?? null;
      r[n] = r[m] ?? null;
      r[m] = tmp;
    });
    scrubStaging(ss);
    for (const v of column(ss, "Claims", "Name")) expect(v === null || v === "").toBe(true); // Name is now where Number was
    for (const v of column(ss, "Claims", "Number")) expect(String(v ?? "")).not.toContain("Testperson");
    expect(ss.snapshot()).not.toContain("Testperson");
  });
});

describe("scrub: fail loud (B4)", () => {
  it("returns per-tab counts keyed by tab name, numbers only", () => {
    const ss = buildStaging();
    const res = scrubStaging(ss);
    expect(Object.keys(res.tabs).sort()).toEqual(ss.getTabs().map((t) => t.name).sort());
    // Hand count from the fixture: Tech has 3 people and 2 notes, Gym 1 person,
    // Books 2 people and 1 note, README 3 numbers.
    expect(res.tabs["Tech"]).toMatchObject({ peopleReplaced: 3, commentsRemoved: 2 });
    expect(res.tabs["Gym & Sport"]).toMatchObject({ peopleReplaced: 1 });
    expect(res.tabs["Books"]).toMatchObject({ peopleReplaced: 2, commentsRemoved: 1 });
    expect(res.tabs["README"]).toMatchObject({ numbersRemoved: 3 });
    for (const c of Object.values(res.tabs)) for (const v of Object.values(c)) expect(typeof v).toBe("number");
  });

  it("reports an empty tabsWithoutPerson and readmeFound true for the normal fixture", () => {
    const res = scrubStaging(buildStaging());
    expect(res.tabsWithoutPerson).toEqual([]);
    expect(res.readmeFound).toBe(true);
  });

  it("names an item-like tab whose person header is not Person (here Buyer)", () => {
    const ss = buildStaging();
    ss.withTab("Garden", [["Item", "Status", "Buyer"], ["Spade", "Reserved", "Asha Testperson"]]);
    const res = scrubStaging(ss);
    expect(res.tabsWithoutPerson).toContain("Garden");
    expect(res.tabsWithoutPerson).not.toContain("Tech");
  });

  it("names a tab that has a title row above its headers", () => {
    const ss = buildStaging();
    ss.withTab("Toys", [["Toys for sale"], [...ITEM_HEADERS], itemRow("Train", "Reserved", "Ravi Samplename")]);
    expect(scrubStaging(ss).tabsWithoutPerson).toContain("Toys");
  });

  it("does not name a tab that has no data rows", () => {
    const ss = buildStaging();
    ss.withTab("Empty", [["Item", "Status", "Buyer"]]);
    expect(scrubStaging(ss).tabsWithoutPerson).not.toContain("Empty");
  });

  it("reports readmeFound false when no tab is named exactly README", () => {
    const ss = new FakeSpreadsheet(TITLE);
    ss.withTab("Read me", [["Notes"]]);
    ss.withTab("Tech", [[...ITEM_HEADERS]]);
    expect(scrubStaging(ss).readmeFound).toBe(false);
  });

  it("scans every cell of a README tab with another name (Read me)", () => {
    const ss = new FakeSpreadsheet(TITLE);
    ss.withTab("Read me", [["Notes"], ["a"], ["b"], ["Call +91 90000 00001"], [null, "90000 00001"], [919000000001]]);
    ss.withTab("Tech", [[...ITEM_HEADERS]]);
    scrubStaging(ss);
    for (const r of ss.getTab("Read me")!.getGrid()) for (const c of r) expect(digitsIn(c).length).toBeLessThan(10);
  });

  it("scans every cell of a tab that is not an item tab, even far from the top", () => {
    const ss = buildStaging();
    ss.withTab("Info", [["Info"], [], [], [], [], [], ["Call", "90000 00001"]]);
    scrubStaging(ss);
    expect(JSON.stringify(ss.getTab("Info")!.getGrid())).not.toContain("00001");
  });

  it("puts tab names, counts, tabs without Person and README status in the log, with no values", () => {
    const ss = buildStaging();
    ss.withTab("Garden", [["Item", "Status", "Buyer"], ["Spade", "Reserved", "Asha Testperson"]]);
    const logged: string[] = [];
    scrubStaging(ss, { log: (l) => logged.push(l) });
    const text = logged.join("\n");
    expect(text).toContain("Garden"); // flagged as having no Person column
    expect(text).toContain("Tech"); // per-tab count line
    expect(text).toMatch(/README/);
    for (const o of ORIGINALS) expect(text).not.toContain(o);
  });

  it("says differently in the log whether README was found", () => {
    const withReadme = new FakeSpreadsheet(TITLE);
    withReadme.withTab("README", [["Notes"]]);
    const without = new FakeSpreadsheet(TITLE);
    without.withTab("Read me", [["Notes"]]);
    const a: string[] = [], b: string[] = [];
    scrubStaging(withReadme, { log: (l) => a.push(l) });
    scrubStaging(without, { log: (l) => b.push(l) });
    expect(a.join("\n")).toMatch(/README/);
    expect(b.join("\n")).toMatch(/README/);
    expect(a.join("\n")).not.toBe(b.join("\n"));
  });
});

describe("scrub: surviving mutants", () => {
  it("replaces the Person in the first data row", () => {
    const ss = mini([["Notes"]], [[...ITEM_HEADERS], itemRow("Kettle", "Reserved", "Kiran Sampleperson")]);
    scrubStaging(ss);
    expect(String(cell(ss, "Tech", 2, 7))).toMatch(/^Test Person \d+$/);
  });

  it("replaces a number in the very first README row and in a header-only tab's header", () => {
    const ss = mini([["Call 90000 00001"]]);
    scrubStaging(ss);
    expect(digitsIn(cell(ss, "README", 1, 1)).length).toBeLessThan(10);
  });

  it("gives different synthetic names to different people", () => {
    const ss = mini([["Notes"]], [
      [...ITEM_HEADERS],
      itemRow("A", "Reserved", "Asha Testperson"),
      itemRow("B", "Reserved", "Ravi Samplename"),
      itemRow("C", "Sold", "Meena Fixture"),
    ]);
    scrubStaging(ss);
    const names = [2, 3, 4].map((r) => String(cell(ss, "Tech", r, 7)));
    expect(new Set(names).size).toBe(3);
    for (const n of names) expect(n.startsWith(SYNTHETIC)).toBe(true);
  });

  it("writes a number-bearing text that starts like a formula with a leading apostrophe", () => {
    const ss = mini([["Notes"], ["=BAD 90000 00001"]]);
    ss.getTab("Tech")!.setCell(1, 10, "+call 90000 00001");
    const readme = ss.getTab("README") as FakeTab;
    const tech = ss.getTab("Tech") as FakeTab;
    readme.writtenStrings = [];
    tech.writtenStrings = [];
    scrubStaging(ss);
    expect(String(cell(ss, "README", 2, 1)).startsWith("'=")).toBe(true);
    expect(String(cell(ss, "Tech", 1, 10)).startsWith("'+")).toBe(true);
    for (const w of [...readme.writtenStrings, ...tech.writtenStrings]) expect(w).not.toMatch(/^[=+\-@]/);
  });
});
