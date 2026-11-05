// Synthetic variant of the staging fixture for D-027: the real build copy has a
// title/notes row ABOVE the headers of every item tab and Template, so the
// header sits on row 2 (not row 1). Built from buildStaging() so the data rows,
// statuses and names are identical to the row-1 fixture; only the rows above
// the header differ. All names and numbers are invented.
import type { FakeSpreadsheet, FakeTab } from "./fake-sheet";
import { SELLER_NUMBER, buildStaging } from "./staging-fixture";

/** A phone-like string in a DATA row, non-Person cell. The scrub must leave it alone. */
export const DATA_ROW_NOTE = "Call 90000 00099 after 5";
/** Title text that must never be mistaken for a Person or an item row. */
export const TITLE_TEXT = "Spring sale list";
export const URL_WITH_NUMBER = "https://wa.me/919000000001";

export const TITLED_TABS = ["Tech", "Gym & Sport", "Home Things", "Books", "Template"] as const;
export type TitledTab = (typeof TITLED_TABS)[number];

/**
 * Pushes the header of `tab` down to sheet row `headerRow` by inserting
 * `headerRow - 1` rows above it. Row 1 is the title; any further rows are plain
 * notes. Comments move down with their rows.
 */
function pushDown(tab: FakeTab, headerRow: number, title: string[]): void {
  const above = headerRow - 1;
  if (above <= 0) return;
  const filler = Array.from({ length: above }, (_, i) => (i === 0 ? title : [`note ${i + 1}`]));
  tab.grid = [...filler, ...tab.grid];
  tab.comments = tab.comments.map((c) => ({ ...c, row: c.row + above }));
}

/**
 * Staging with the header on row 2 of every item tab and Template, unless
 * `headerRows` overrides a tab (1 = unchanged, 6 = beyond the top-5 window).
 *
 * Row 1 of Tech holds the seller's number as text (A1), inside a formula (C1)
 * and inside a link (D1). Row 1 of Books has text in columns A and B, which are
 * Person and Status in that tab, to prove the title is never read as data.
 * Tech's first data row has a phone-like string in Notes.
 */
export function buildStagingTitled(
  headerRows: Partial<Record<TitledTab, number>> = {},
  title = "A44 Garage Sale BUILD COPY",
): FakeSpreadsheet {
  const ss = buildStaging(title);
  const at = (n: TitledTab) => headerRows[n] ?? 2;

  // Data-row phone string goes in before the rows move (Tech row 2, Notes col 8).
  ss.getTab("Tech")!.setCell(2, 8, DATA_ROW_NOTE);

  pushDown(ss.getTab("Tech") as FakeTab, at("Tech"), [`Tech - WhatsApp ${SELLER_NUMBER}`, null as never, "Chat", "Chat link"]);
  pushDown(ss.getTab("Gym & Sport") as FakeTab, at("Gym & Sport"), [TITLE_TEXT]);
  pushDown(ss.getTab("Home Things") as FakeTab, at("Home Things"), [TITLE_TEXT]);
  // Books: Person is column A and Status is column B in this tab.
  pushDown(ss.getTab("Books") as FakeTab, at("Books"), ["Books - full list", "Spring 2026"]);
  pushDown(ss.getTab("Template") as FakeTab, at("Template"), [TITLE_TEXT]);

  if (at("Tech") >= 2) {
    const tech = ss.getTab("Tech") as FakeTab;
    tech.setFormula(1, 3, `=HYPERLINK("${URL_WITH_NUMBER}","Chat")`);
    tech.setLink(1, 4, URL_WITH_NUMBER);
  }
  return ss;
}
