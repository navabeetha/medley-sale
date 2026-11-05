// D-028: the real Books tab has no "Item" column. Its book name sits under
// "Brand" (the tab was copied from the item layout), next to "Author". The
// first live migrateSheet run refused with: Tab "Books" has no "Item" column.
// Synthetic data only.
import { describe, expect, it } from "vitest";
import { migrate, scrubStaging } from "../../src/api/migrate";
import { counterRandom, type FakeSpreadsheet } from "../fixtures/fake-sheet";
import { buildStagingTitled } from "../fixtures/title-row-fixture";

const NOW = "2026-11-05T10:00:00.000Z";

/** The live Books heading, copied from the build copy's header row (2026-11-05). */
const LIVE_BOOKS_NAME_HEADER = "Brand (+ Link)";

/** Renames the Books "Item" header, by default to the live copy's heading. */
function liveBooksLayout(header = LIVE_BOOKS_NAME_HEADER): FakeSpreadsheet {
  const ss = buildStagingTitled();
  const books = ss.getTab("Books")!;
  const grid = books.getGrid();
  const hr = grid.findIndex((r) => r.includes("Person"));
  const col = grid[hr]!.indexOf("Item");
  expect(col).toBeGreaterThanOrEqual(0);
  books.setCell(hr + 1, col + 1, header);
  return ss;
}

function run(ss: FakeSpreadsheet) {
  scrubStaging(ss);
  return migrate(ss, { randomBytes: counterRandom().fn, now: () => NOW });
}

describe("Books name column (D-028)", () => {
  it.each([LIVE_BOOKS_NAME_HEADER, "Brand"])("migrates a Books tab whose book name is under %j", (header) => {
    const ss = liveBooksLayout(header);
    expect(() => run(ss)).not.toThrow();
  });

  it("uses the Brand cell as the claim's item name on Books", () => {
    const ss = liveBooksLayout();
    run(ss);
    const claims = ss.getTab("Claims")!.getGrid();
    const itemCol = claims[0]!.indexOf("Item");
    // "Slow Rivers" is a sold book in the fixture; its name must come from Brand, not Author.
    expect(claims.slice(1).map((r) => r[itemCol])).toContain("Slow Rivers");
    expect(claims.slice(1).map((r) => r[itemCol])).not.toContain("Author Q");
  });

  it("still prefers Item on Books when both Item and Brand exist", () => {
    const ss = buildStagingTitled();
    const books = ss.getTab("Books")!;
    const grid = books.getGrid();
    const hr = grid.findIndex((r) => r.includes("Person"));
    books.setCell(hr + 1, grid[hr]!.length + 1, "Brand");
    run(ss);
    const claims = ss.getTab("Claims")!.getGrid();
    expect(claims.slice(1).map((r) => r[claims[0]!.indexOf("Item")])).toContain("Slow Rivers");
  });

  it("does not accept Brand as the item name on other tabs", () => {
    const ss = buildStagingTitled();
    const tech = ss.getTab("Tech")!;
    const grid = tech.getGrid();
    const hr = grid.findIndex((r) => r.includes("Person"));
    tech.setCell(hr + 1, grid[hr]!.indexOf("Item") + 1, "Thing");
    expect(() => run(ss)).toThrow(/Tech.*has no "Item" column/);
  });
});
