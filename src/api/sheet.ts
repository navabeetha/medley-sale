// Minimal spreadsheet interface (S-03). The Apps Script adapter implements it
// over SpreadsheetApp; unit tests use the in-memory fake in test/fixtures.
// Rows and columns are 1-based. Row 1 is the header row. No logic lives here.

export type CellValue = string | number | boolean | Date | null;

export interface Tab {
  readonly name: string;
  /** Every row, header row first. Rows may be shorter than the widest row. */
  getGrid(): CellValue[][];
  /** Write one cell as a plain value. Strings are stored exactly as given. */
  setCell(row: number, col: number, value: CellValue): void;
  /** Append a row after the last used row. */
  appendRow(values: CellValue[]): void;
  getComments(): { row: number; col: number }[];
  /** Removes every comment; returns how many were removed. */
  clearComments(): number;
  setDataValidation(col: number, allowed: string[]): void;
  getDataValidation(col: number): string[] | null;
  /** Write a formula (the string starts with "="). */
  setFormula(row: number, col: number, formula: string): void;
  getFormulas(): { row: number; col: number; formula: string }[];
}

export interface Spreadsheet {
  getTitle(): string;
  getTabs(): Tab[];
  getTab(name: string): Tab | undefined;
  addTab(name: string): Tab;
}
