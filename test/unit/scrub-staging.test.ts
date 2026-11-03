import { afterEach, describe, expect, it, vi } from "vitest";
import { scrubStaging } from "../../src/api/migrate";
import type { Tab } from "../../src/api/sheet";
import { FakeSpreadsheet } from "../fixtures/fake-sheet";
import { BUYER_NAMES, FORMULA_NAME, ORIGINALS, SELLER_NUMBER, buildStaging } from "../fixtures/staging-fixture";

// S-03 acceptance, scrubStaging(): refuses unless the title contains BUILD COPY;
// replaces every Person with a synthetic name (column found by header); removes
// the seller's number from README and all tab headers (any phone-like string,
// the code is never given the number); removes comments; returns counts only.

// Phone-like: 10 or more digits, allowing spaces or dashes between them.
const PHONE_LIKE = /\+?\d(?:[\s-]?\d){9,}/;

const grid = (ss: FakeSpreadsheet, name: string) => ss.getTab(name)!.getGrid();
const colOf = (tab: Tab, header: string) => tab.getGrid()[0]!.indexOf(header);
const personsOf = (ss: FakeSpreadsheet, name: string) => {
  const tab = ss.getTab(name)!;
  const c = colOf(tab, "Person");
  return tab.getGrid().slice(1).map((r) => r[c] ?? null);
};

afterEach(() => vi.restoreAllMocks());

describe("scrubStaging refusal", () => {
  it("refuses with a clear error when the title lacks BUILD COPY", () => {
    const ss = buildStaging("A44 Garage Sale");
    expect(() => scrubStaging(ss)).toThrow(/BUILD COPY/);
  });

  it("changes nothing when it refuses", () => {
    const ss = buildStaging("A44 Garage Sale");
    const before = ss.snapshot();
    try { scrubStaging(ss); } catch { /* expected */ }
    expect(ss.snapshot()).toBe(before);
  });

  it("refuses a lower-case 'build copy' title (exact marker only)", () => {
    expect(() => scrubStaging(buildStaging("A44 build copy"))).toThrow(/BUILD COPY/);
  });

  it("runs when the title contains BUILD COPY anywhere", () => {
    expect(() => scrubStaging(buildStaging("My sale BUILD COPY v2"))).not.toThrow();
  });
});

describe("scrubStaging people", () => {
  it("replaces every Person value so no original name remains in any tab", () => {
    const ss = buildStaging();
    scrubStaging(ss);
    const all = JSON.stringify(ss.getTabs().map((t) => t.getGrid()));
    for (const name of [...BUYER_NAMES, FORMULA_NAME]) expect(all).not.toContain(name);
  });

  it("puts a non-blank synthetic name wherever a Person was set", () => {
    const ss = buildStaging();
    scrubStaging(ss);
    expect(personsOf(ss, "Tech").slice(1, 4).every((p) => typeof p === "string" && p.trim() !== "")).toBe(true);
  });

  it("leaves blank Person cells blank", () => {
    const ss = buildStaging();
    scrubStaging(ss);
    expect(personsOf(ss, "Tech")[0]).toBeNull(); // Echo Dot, Available
    expect(personsOf(ss, "Books")[0]).toBeNull(); // Free Fall, Available
  });

  it("finds Person by header name when the column is not in the same position", () => {
    const ss = buildStaging();
    const techCol = colOf(ss.getTab("Tech")!, "Person");
    const booksCol = colOf(ss.getTab("Books")!, "Person");
    expect(techCol).not.toBe(booksCol); // fixture guard
    scrubStaging(ss);
    expect(personsOf(ss, "Books")[1]).not.toBe("Meena Fixture");
    expect(personsOf(ss, "Books")[1]).toBeTruthy();
  });

  it("does not touch any other column in item tabs", () => {
    const ss = buildStaging();
    const strip = (name: string) => {
      const tab = ss.getTab(name)!;
      const c = colOf(tab, "Person");
      return tab.getGrid().slice(1).map((r) => r.filter((_, i) => i !== c));
    };
    const before = ["Tech", "Books", "Gym & Sport"].map(strip);
    scrubStaging(ss);
    expect(["Tech", "Books", "Gym & Sport"].map(strip)).toEqual(before);
  });

  it("keeps Status unchanged so Reserved and Sold rows still have a person", () => {
    const ss = buildStaging();
    const tab = ss.getTab("Tech")!;
    const c = colOf(tab, "Status");
    const before = tab.getGrid().map((r) => r[c]);
    scrubStaging(ss);
    expect(ss.getTab("Tech")!.getGrid().map((r) => r[c])).toEqual(before);
  });
});

describe("scrubStaging seller number", () => {
  it("removes every phone-like string from the README", () => {
    const ss = buildStaging();
    scrubStaging(ss);
    for (const r of grid(ss, "README")) for (const cell of r) expect(String(cell ?? "")).not.toMatch(PHONE_LIKE);
  });

  it("keeps README text that is not a number", () => {
    const ss = buildStaging();
    scrubStaging(ss);
    const text = JSON.stringify(grid(ss, "README"));
    expect(text).toContain("Garage sale notes");
    expect(text).toContain("Open 10 to 5, prices from 100");
  });

  it("removes phone-like strings from the header row of every tab", () => {
    const ss = buildStaging();
    ss.getTab("Tech")!.setCell(1, 10, `Link (WhatsApp ${SELLER_NUMBER})`);
    ss.getTab("Books")!.setCell(1, 10, "Link +919000000001");
    scrubStaging(ss);
    for (const tab of ss.getTabs()) {
      for (const h of tab.getGrid()[0] ?? []) expect(String(h ?? "")).not.toMatch(PHONE_LIKE);
    }
  });

  it("leaves ordinary header names intact so columns are still found by name", () => {
    const ss = buildStaging();
    ss.getTab("Tech")!.setCell(1, 10, `Link (WhatsApp ${SELLER_NUMBER})`);
    scrubStaging(ss);
    const headers = ss.getTab("Tech")!.getGrid()[0]!;
    for (const h of ["Item", "Price", "Status", "Person"]) expect(headers).toContain(h);
  });

  it("removes comments from every tab", () => {
    const ss = buildStaging();
    scrubStaging(ss);
    for (const tab of ss.getTabs()) expect(tab.getComments()).toEqual([]);
  });
});

describe("scrubStaging result", () => {
  it("returns counts of what it changed", () => {
    const ss = buildStaging();
    ss.getTab("Tech")!.setCell(1, 10, `Link (WhatsApp ${SELLER_NUMBER})`);
    ss.getTab("Books")!.setCell(1, 10, "Link +919000000001");
    const res = scrubStaging(ss);
    // Hand count from the fixture: Person values 3 (Tech, one is the formula
    // name) + 1 (Gym) + 2 (Books) = 6. Cells holding a number: 3 README + 2
    // headers = 5. Comments: 2 (Tech) + 1 (Books) = 3.
    expect(res).toMatchObject({ peopleReplaced: 6, numbersRemoved: 5, commentsRemoved: 3 });
  });

  it("contains none of the original names or numbers in the result or the logs", () => {
    const ss = buildStaging();
    const logged: string[] = [];
    (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" "))),
    );
    const res = scrubStaging(ss, { log: (l) => logged.push(l) });
    const everything = JSON.stringify(res) + logged.join("\n");
    for (const original of ORIGINALS) expect(everything).not.toContain(original);
  });

  it("does not put original values in the refusal error either", () => {
    const ss = buildStaging("A44 Garage Sale");
    let message = "";
    try { scrubStaging(ss); } catch (e) { message = String((e as Error).message); }
    for (const original of ORIGINALS) expect(message).not.toContain(original);
    expect(message).toMatch(/BUILD COPY/);
  });
});
