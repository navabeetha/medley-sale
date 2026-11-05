// S-04: the public catalogue (brief 4.3, 6.1; D-026, D-027, D-028, D-030).
// Pure logic over the Spreadsheet interface. This is the ONLY data that leaves
// the sheet without a token, so it is built field by field from an allow-list
// and never copies a row: nothing from Claims (beyond the counts the queue
// engine derives), Bookings or the Person column can reach the response (T-12).
import { findHeaderRow } from "./header-row";
import { itemNameCol } from "./migrate";
import type { CellValue, Spreadsheet, Tab } from "./sheet";
import { recalculate, type ClaimInput, type ClaimState } from "../domain/queue";

/** One item as the site sees it. Exactly these keys, see D-030 rule 1. */
export interface CatalogueItem {
  id: string;
  tab: string;
  name: string;
  brand: string | null;
  author: string | null;
  category: string | null;
  price: number | null;
  availableFrom: string | null;
  notes: string | null;
  link: string | null;
  quantity: number;
  unitsLeft: number;
  freeUnits: number;
  waitingCount: number;
  photos: number;
}

export interface CatalogueOptions {
  /** Photos per item ID (from the S-05 manifest). Missing means 0. */
  photoCounts?: Record<string, number>;
}

/** Tabs that are not item tabs. Anything else in the spreadsheet is a category tab. */
const NON_ITEM_TABS = ["README", "Template", "Claims", "Bookings", "To do", "Sold"];
const BOOKS = "Books";
/** Where the brand (or on Books, the book name) and its rich-text link live. */
const BRAND_HEADERS = ["Brand (+ Link)", "Brand"];

/** 1-based column of the first header matching one of `names`, or 0. */
function col(head: CellValue[], names: string[]): number {
  return head.findIndex((h) => typeof h === "string" && names.includes(h.trim())) + 1;
}

const blank = (v: CellValue | undefined): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Plain text of a cell, or null when blank. */
const text = (v: CellValue | undefined): string | null => (blank(v) ? null : String(v).trim());

/** A Date becomes an ISO string; text such as "Now" passes through (D-030 rule 6). */
function dateOrText(v: CellValue | undefined): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return text(v);
}

/** Links become hrefs on the site, so only http(s) survives (D-030 rule 5). */
function safeLink(url: string | undefined): string | null {
  // The adapter joins several link runs in one cell with a space; use the first.
  const first = url?.trim().split(/\s+/)[0];
  return first && /^https?:\/\//i.test(first) ? first : null;
}

/** Claims by header name (brief 4.1). Only Claim ID, Item ID and State are read. */
function readClaims(ss: Spreadsheet): ClaimInput[] {
  const grid = ss.getTab("Claims")?.getGrid() ?? [];
  const head = grid[0] ?? [];
  const idCol = col(head, ["Claim ID"]);
  const itemCol = col(head, ["Item ID"]);
  const stateCol = col(head, ["State"]);
  if (!idCol || !itemCol || !stateCol) return [];
  const out: ClaimInput[] = [];
  for (const r of grid.slice(1)) {
    const state = r[stateCol - 1];
    const itemId = text(r[itemCol - 1]);
    if (!itemId || (state !== "active" && state !== "released" && state !== "sold")) continue;
    // previousRole null: we only read the figures, we never promote anybody here.
    out.push({ claimId: Number(r[idCol - 1]), itemId, state: state as ClaimState, promotedAt: null, previousRole: null });
  }
  return out;
}

function tabItems(tab: Tab, claims: ClaimInput[], photoCounts: Record<string, number>): CatalogueItem[] {
  const grid = tab.getGrid();
  const hr = findHeaderRow(grid);
  if (hr < 0) return [];
  const head = grid[hr]!;
  const nameCol = itemNameCol(tab, head);
  const idCol = col(head, ["ID"]);
  if (!nameCol || !idCol) return [];
  const isBooks = tab.name === BOOKS;
  const brandCol = isBooks ? 0 : col(head, BRAND_HEADERS);
  // The link sits on the brand cell, or on Books the book-name cell.
  const linkCol = isBooks ? nameCol : brandCol;
  const authorCol = isBooks ? col(head, ["Author"]) : 0;
  const categoryCol = col(head, ["Category"]);
  const priceCol = col(head, ["Price"]);
  const fromCol = col(head, ["Available from"]);
  const notesCol = col(head, ["Notes"]);
  const qtyCol = col(head, ["Quantity"]);
  const cell = (cells: CellValue[], c: number): CellValue | undefined => (c ? cells[c - 1] : undefined);
  const links = new Map(tab.getLinks().map((l) => [`${l.row}:${l.col}`, l.url]));

  const out: CatalogueItem[] = [];
  for (let r = hr + 1; r < grid.length; r++) {
    const cells = grid[r]!;
    const id = text(cells[idCol - 1]);
    const name = text(cells[nameCol - 1]);
    if (!id || !name) continue;
    const quantity = cell(cells, qtyCol);
    const q = typeof quantity === "number" ? quantity : NaN;
    const calc = recalculate({ id, quantity: q }, claims, "");
    // Sold out is decided by Claims and Quantity, never the Status text (D-030 rule 4).
    if (calc.unavailable || calc.soldOut) continue;
    const price = cell(cells, priceCol);
    out.push({
      id,
      tab: tab.name,
      name,
      brand: isBooks ? null : text(cell(cells, brandCol)),
      author: text(cell(cells, authorCol)),
      category: text(cell(cells, categoryCol)),
      price: typeof price === "number" ? price : null,
      availableFrom: dateOrText(cell(cells, fromCol)),
      notes: text(cell(cells, notesCol)),
      link: linkCol ? safeLink(links.get(`${r + 1}:${linkCol}`)) : null,
      quantity: q,
      unitsLeft: calc.unitsLeft,
      freeUnits: calc.freeUnits,
      waitingCount: calc.waitingCount,
      photos: photoCounts[id] ?? 0,
    });
  }
  return out;
}

export function catalogue(ss: Spreadsheet, opts: CatalogueOptions = {}): { items: CatalogueItem[] } {
  const claims = readClaims(ss);
  const photoCounts = opts.photoCounts ?? {};
  const items = ss
    .getTabs()
    .filter((t) => !NON_ITEM_TABS.includes(t.name))
    .flatMap((t) => tabItems(t, claims, photoCounts));
  return { items };
}
