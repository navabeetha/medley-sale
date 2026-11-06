// Minimal spreadsheet interface (S-03). The Apps Script adapter implements it
// over SpreadsheetApp; unit tests use the in-memory fake in test/fixtures.
// Rows and columns are 1-based. System tabs (Claims, Bookings, To do, Sold) have
// their header in row 1; item tabs and Template may not (D-027: use findHeaderRow
// in header-row.ts). No logic lives here.

export type CellValue = string | number | boolean | Date | null;

export interface Tab {
  readonly name: string;
  /** Every row, header row first. Rows may be shorter than the widest row. */
  getGrid(): CellValue[][];
  /**
   * Write one cell as a plain value. The fake stores it as given; real Sheets
   * parses it (a leading apostrophe is not read back, "1/2" may become a date,
   * "00123" a number). Blank cells read back as null in the fake, "" in Sheets:
   * treat both as blank.
   */
  setCell(row: number, col: number, value: CellValue): void;
  /** Append a row after the last used row. */
  appendRow(values: CellValue[]): void;
  /** Append several rows after the last used row in ONE write: all of them or none (QA F1). */
  appendRows(rows: CellValue[][]): void;
  /** Set a plain-text note on a cell (replacing any earlier one); "" removes it. S-15: why an edit was reverted (6.1.7). */
  setNote(row: number, col: number, text: string): void;
  /** The note on a cell, or null when it has none (S-15 QA F3: tell our own note from the seller's). */
  getNote(row: number, col: number): string | null;
  getComments(): { row: number; col: number }[];
  /** Removes every comment; returns how many were removed. */
  clearComments(): number;
  setDataValidation(col: number, allowed: string[]): void;
  getDataValidation(col: number): string[] | null;
  /** Write a formula (the string starts with "="). */
  setFormula(row: number, col: number, formula: string): void;
  getFormulas(): { row: number; col: number; formula: string }[];
  /** Hyperlink URLs attached to cells (rich-text links), one entry per linked cell. */
  getLinks(): { row: number; col: number; url: string }[];
  /** Attach a link to a cell's text, or remove it with null. */
  setLink(row: number, col: number, url: string | null): void;
}

export interface Spreadsheet {
  getTitle(): string;
  getTabs(): Tab[];
  getTab(name: string): Tab | undefined;
  addTab(name: string): Tab;
  /** Commit pending writes now (SpreadsheetApp.flush()); call before releasing a lock (QA F2). */
  flush(): void;
}
