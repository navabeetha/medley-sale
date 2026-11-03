// S-03: scrubStaging() and migrate() (brief 4.1, 4.2, 6.3). Pure logic over the
// Spreadsheet interface; the Apps Script adapter and the in-memory fake both
// implement it. Columns are always found by header name, never by position.
// Logs and results carry counts only: no names, numbers or tokens.
import type { CellValue, Spreadsheet, Tab } from "./sheet";

export interface ScrubOptions {
  /** Optional sink for progress lines. Must only ever receive counts. */
  log?: (line: string) => void;
}

export interface TabScrubCounts {
  peopleReplaced: number;
  numbersRemoved: number;
  commentsRemoved: number;
}

/** Counts only. Never original values. */
export interface ScrubResult {
  peopleReplaced: number;
  /** Cells (README and header rows) from which a phone number was removed. */
  numbersRemoved: number;
  commentsRemoved: number;
  /** Per-tab counts, keyed by tab name (names only, never values). */
  tabs: Record<string, TabScrubCounts>;
  /** Tabs that have data but no Person header: their names were NOT replaced. */
  tabsWithoutPerson: string[];
  /** Whether a tab named exactly README exists. */
  readmeFound: boolean;
}

export interface MigrateOptions {
  /** Cryptographic random source: returns n random bytes. */
  randomBytes: (n: number) => Uint8Array;
  /** ISO timestamp used for `Created`. */
  now: () => string;
  log?: (line: string) => void;
  /**
   * Skips ONLY the "has the scrub run" check (every Person matches the scrub's
   * format). The BUILD COPY title check can never be skipped. For tests that
   * need unscrubbed fixtures.
   */
  allowUnscrubbed?: boolean;
}

/** Counts of changes made by this run. All zero on a rerun. */
export interface MigrateResult {
  columnsAdded: number;
  tabsCreated: number;
  idsAssigned: number;
  quantitiesSet: number;
  bookingsCreated: number;
  claimsCreated: number;
  /** Reserved or Sold rows with a blank Person: no claim is made. */
  reservedOrSoldWithoutPerson: number;
  /** Available rows that have a Person: ignored, no claim. */
  availableWithPerson: number;
  /** Sold rows whose Price is not a number: the claim gets a blank Sold price. */
  soldWithTextPrice: number;
}

// ---- Names that depend on the real sheet: extend here once headers are known.

/** Accepted headers for the item-name column (Books may differ from the rest). */
export const ITEM_NAME_HEADERS = ["Item"];
const PERSON = "Person";
const STATUS = "Status";
const PRICE = "Price";
const ID = "ID";
const QUANTITY = "Quantity";
const VALID_STATUSES = ["Available", "Reserved", "Sold"];
const BUILD_COPY_MARKER = "BUILD COPY";

const CLAIM_HEADERS = [
  "Claim ID", "Booking ID", "Item ID", "Item", "Name", "Number", "State", "Created",
  "Promoted at", "Notified", "Sold price", "Sold at", "Ended at", "Message link",
];
const BOOKING_HEADERS = ["Booking ID", "Token", "Name", "Number", "Created", "Idempotency key", "WhatsApp opened"];
const CLAIMS = "Claims";
const BOOKINGS = "Bookings";
const TODO = "To do";
const SOLD = "Sold";
const TEMPLATE = "Template";
const README = "README";
const NON_ITEM_TABS = new Set([README, TEMPLATE, CLAIMS, BOOKINGS, TODO, SOLD]);

// Phone-like: 10 or more digits, allowing spaces or dashes between them.
const PHONE_LIKE = /\+?\d(?:[\s-]?\d){9,}/g;

// ---- Small helpers

/** 6.3: a plain-text string that could be read as a formula gets a leading apostrophe. */
export function guardText(s: string): string {
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

const isBlank = (v: CellValue | undefined): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** 1-based column of the first header matching any name, or 0. */
function findCol(head: CellValue[], names: string[]): number {
  const i = head.findIndex((h) => typeof h === "string" && names.includes(h.trim()));
  return i + 1;
}

/** 1-based column of a header, or 0. */
const colOf = (head: CellValue[], name: string): number => findCol(head, [name]);

function requireCol(tab: Tab, head: CellValue[], names: string[]): number {
  const c = findCol(head, names);
  if (!c) throw new Error(`Tab "${tab.name}" has no "${names[0]}" column`);
  return c;
}

function maxNumber(values: CellValue[]): number {
  let max = 0;
  for (const v of values) if (typeof v === "number" && Number.isInteger(v) && v > max) max = v;
  return max;
}

// ---- scrubStaging

export function scrubStaging(ss: Spreadsheet, opts: ScrubOptions = {}): ScrubResult {
  if (!ss.getTitle().includes(BUILD_COPY_MARKER)) {
    throw new Error(`scrubStaging refused: the file title must contain "${BUILD_COPY_MARKER}"`);
  }
  let peopleReplaced = 0;
  let numbersRemoved = 0;
  let commentsRemoved = 0;

  for (const tab of ss.getTabs()) {
    const grid = tab.getGrid();
    // Seller's number: every README cell, and the header row of every tab.
    grid.forEach((row, r) => {
      if (tab.name !== README && r > 0) return;
      row.forEach((cell, c) => {
        if (typeof cell !== "string") return;
        const cleaned = cell.replace(PHONE_LIKE, "[removed]");
        if (cleaned === cell) return;
        tab.setCell(r + 1, c + 1, guardText(cleaned));
        numbersRemoved++;
      });
    });
    // People: every non-blank Person cell becomes a synthetic name.
    const personCol = colOf(grid[0] ?? [], PERSON);
    if (personCol) {
      for (let r = 1; r < grid.length; r++) {
        if (isBlank(grid[r]![personCol - 1])) continue;
        peopleReplaced++;
        tab.setCell(r + 1, personCol, `Test Person ${peopleReplaced}`);
      }
    }
    commentsRemoved += tab.clearComments();
  }

  const result: ScrubResult = {
    peopleReplaced, numbersRemoved, commentsRemoved,
    tabs: {}, tabsWithoutPerson: [], readmeFound: false, // stub (S-03 fix round)
  };
  opts.log?.(`scrubStaging: ${peopleReplaced} people replaced, ${numbersRemoved} cells cleared of numbers, ${commentsRemoved} comments removed`);
  return result;
}

// ---- migrate

interface ItemRow {
  tab: Tab;
  row: number; // 1-based sheet row
  status: string;
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Items tabs: everything that is not README, Template or a system tab. */
function itemTabs(ss: Spreadsheet): Tab[] {
  return ss.getTabs().filter((t) => !NON_ITEM_TABS.has(t.name));
}

/** Every non-empty data row of an item tab, with its status checked. Writes nothing. */
function validateTab(tab: Tab): ItemRow[] {
  const grid = tab.getGrid();
  const head = grid[0] ?? [];
  requireCol(tab, head, ITEM_NAME_HEADERS);
  const statusCol = requireCol(tab, head, [STATUS]);
  requireCol(tab, head, [PERSON]);
  const skip = [colOf(head, ID), colOf(head, QUANTITY)];
  const rows: ItemRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    if (cells.every((v, i) => isBlank(v) || skip.includes(i + 1))) continue;
    const status = cells[statusCol - 1];
    if (typeof status !== "string" || !VALID_STATUSES.includes(status)) {
      throw new Error(`Tab "${tab.name}" row ${r + 1}: Status must be exactly Available, Reserved or Sold`);
    }
    rows.push({ tab, row: r + 1, status });
  }
  return rows;
}

/** Returns the tab, creating it (and returning created=true) when missing. */
function ensureTab(ss: Spreadsheet, name: string): { tab: Tab; created: boolean } {
  const existing = ss.getTab(name);
  if (existing) return { tab: existing, created: false };
  return { tab: ss.addTab(name), created: true };
}

const letter = (col: number): string => String.fromCharCode(64 + col);
const claimRange = (header: string): string => {
  const l = letter(CLAIM_HEADERS.indexOf(header) + 1);
  return `${CLAIMS}!${l}2:${l}`;
};

function writeHeaders(tab: Tab, headers: string[]): void {
  headers.forEach((h, i) => tab.setCell(1, i + 1, h));
}

export function migrate(ss: Spreadsheet, opts: MigrateOptions): MigrateResult {
  const result: MigrateResult = {
    columnsAdded: 0, tabsCreated: 0, idsAssigned: 0,
    quantitiesSet: 0, bookingsCreated: 0, claimsCreated: 0,
    reservedOrSoldWithoutPerson: 0, availableWithPerson: 0, soldWithTextPrice: 0,
  };

  // 1. Check every row before writing anything.
  const items = itemTabs(ss);
  const rows = items.flatMap(validateTab);

  // 2. New tabs, State validation, To do and Sold formulas.
  const claimsT = ensureTab(ss, CLAIMS);
  if (claimsT.created) {
    writeHeaders(claimsT.tab, CLAIM_HEADERS);
    claimsT.tab.setDataValidation(CLAIM_HEADERS.indexOf("State") + 1, ["active", "released", "sold"]);
    result.tabsCreated++;
  }
  const bookingsT = ensureTab(ss, BOOKINGS);
  if (bookingsT.created) {
    writeHeaders(bookingsT.tab, BOOKING_HEADERS);
    result.tabsCreated++;
  }
  const todoT = ensureTab(ss, TODO);
  if (todoT.created) {
    writeHeaders(todoT.tab, CLAIM_HEADERS);
    // Holders promoted off the waiting list and not yet notified (Notified unticked).
    todoT.tab.setFormula(2, 1,
      `=IFERROR(FILTER(${CLAIMS}!A2:N, ${claimRange("State")}="active", ${claimRange("Promoted at")}<>"", ${claimRange("Notified")}<>TRUE), "")`);
    result.tabsCreated++;
  }
  const soldT = ensureTab(ss, SOLD);
  if (soldT.created) {
    writeHeaders(soldT.tab, CLAIM_HEADERS);
    soldT.tab.setFormula(2, 1, `=IFERROR(FILTER(${CLAIMS}!A2:N, ${claimRange("State")}="sold"), "")`);
    soldT.tab.setCell(1, CLAIM_HEADERS.length + 2, "Total sold");
    soldT.tab.setFormula(1, CLAIM_HEADERS.length + 3,
      `=SUMIF(${claimRange("State")}, "sold", ${claimRange("Sold price")})`);
    result.tabsCreated++;
  }

  // 3. ID and Quantity columns after the existing ones, Template included.
  const template = ss.getTab(TEMPLATE);
  for (const tab of template ? [...items, template] : items) {
    const head = tab.getGrid()[0] ?? [];
    for (const name of [ID, QUANTITY]) {
      if (colOf(head, name)) continue;
      tab.setCell(1, head.length + 1, name);
      head.push(name);
      result.columnsAdded++;
    }
  }

  // 4. Stable IDs (kept if already set) and quantity 1 where blank.
  const usedIds = new Set<string>();
  for (const tab of items) {
    const grid = tab.getGrid();
    const idCol = colOf(grid[0]!, ID);
    for (const r of grid.slice(1)) if (!isBlank(r[idCol - 1])) usedIds.add(String(r[idCol - 1]));
  }
  let nextId = 1;
  const newId = (): string => {
    let id: string;
    do id = `I-${String(nextId++).padStart(4, "0")}`; while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const fillQuantity = (tab: Tab, row: number, qtyCol: number, cells: CellValue[]) => {
    if (!isBlank(cells[qtyCol - 1])) return;
    tab.setCell(row, qtyCol, 1);
    result.quantitiesSet++;
  };
  for (const { tab, row } of rows) {
    const grid = tab.getGrid();
    const head = grid[0]!;
    const cells = grid[row - 1]!;
    const idCol = colOf(head, ID);
    if (isBlank(cells[idCol - 1])) {
      tab.setCell(row, idCol, newId());
      result.idsAssigned++;
    }
    fillQuantity(tab, row, colOf(head, QUANTITY), cells);
  }
  if (template) {
    const grid = template.getGrid();
    const head = grid[0] ?? [];
    const skip = [colOf(head, ID), colOf(head, QUANTITY)];
    for (let r = 1; r < grid.length; r++) {
      if (grid[r]!.every((v, i) => isBlank(v) || skip.includes(i + 1))) continue;
      fillQuantity(template, r + 1, colOf(head, QUANTITY), grid[r]!);
    }
  }

  // 5. One booking and one claim per Reserved or Sold row with a Person.
  const claimGrid = claimsT.tab.getGrid();
  const claimHead = claimGrid[0] ?? [];
  const claimItemCol = requireCol(claimsT.tab, claimHead, ["Item ID"]);
  const claimed = new Set(claimGrid.slice(1).map((r) => String(r[claimItemCol - 1] ?? "")));
  let nextClaim = maxNumber(claimGrid.slice(1).map((r) => r[colOf(claimHead, "Claim ID") - 1] ?? null)) + 1;
  const bookingGrid = bookingsT.tab.getGrid();
  let nextBooking = maxNumber(bookingGrid.slice(1).map((r) => r[colOf(bookingGrid[0] ?? [], "Booking ID") - 1] ?? null)) + 1;

  for (const { tab, row, status } of rows) {
    if (status === "Available") continue;
    const grid = tab.getGrid();
    const head = grid[0]!;
    const cells = grid[row - 1]!;
    const person = cells[colOf(head, PERSON) - 1];
    if (isBlank(person)) continue;
    const itemId = String(cells[colOf(head, ID) - 1]);
    if (claimed.has(itemId)) continue;
    claimed.add(itemId);

    const name = guardText(String(person));
    const item = guardText(String(cells[findCol(head, ITEM_NAME_HEADERS) - 1] ?? ""));
    const price = cells[colOf(head, PRICE) - 1];
    const now = opts.now();
    const bookingId = nextBooking++;
    // 128 bits from the injected source, as 32 hex characters (D-005).
    const token = hex(opts.randomBytes(16));
    bookingsT.tab.appendRow([bookingId, token, name, "", now, "", ""]);
    claimsT.tab.appendRow([
      nextClaim++, bookingId, itemId, item, name, "",
      status === "Sold" ? "sold" : "active", now, "", "",
      status === "Sold" && typeof price === "number" ? price : "", "", "", "",
    ]);
    result.bookingsCreated++;
    result.claimsCreated++;
  }

  opts.log?.(
    `migrate: ${result.columnsAdded} columns added, ${result.tabsCreated} tabs created, ` +
      `${result.idsAssigned} IDs assigned, ${result.quantitiesSet} quantities set, ` +
      `${result.bookingsCreated} bookings created, ${result.claimsCreated} claims created`,
  );
  return result;
}
