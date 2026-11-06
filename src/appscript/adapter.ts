// Thin Apps Script adapter: wraps a Spreadsheet in the interface of
// src/api/sheet.ts. No logic lives here; it is not unit-tested.

import type { CellValue, Spreadsheet, Tab } from "../api/sheet";

class SheetTab implements Tab {
  constructor(private readonly sheet: GoogleAppsScript.Spreadsheet.Sheet) {}

  get name(): string {
    return this.sheet.getName();
  }
  getGrid(): CellValue[][] {
    if (this.sheet.getLastRow() === 0 || this.sheet.getLastColumn() === 0) return [];
    return this.sheet.getDataRange().getValues() as CellValue[][];
  }
  setCell(row: number, col: number, value: CellValue): void {
    this.sheet.getRange(row, col).setValue(value);
  }
  appendRow(values: CellValue[]): void {
    this.sheet.appendRow(values);
  }
  appendRows(rows: CellValue[][]): void {
    if (rows.length === 0) return;
    // One setValues call, so the rows land together or not at all. Rows must be the same width.
    const width = Math.max(...rows.map((r) => r.length));
    const padded = rows.map((r) => [...r, ...new Array<CellValue>(width - r.length).fill(null)]);
    const first = this.sheet.getLastRow() + 1;
    // S-15 QA: setValues past the last row of the grid fails or lands outside the sheet, so add the rows
    // we need first. (G1 live check: book enough items to run Claims past its last row.)
    const missing = first + padded.length - 1 - this.sheet.getMaxRows();
    if (missing > 0) this.sheet.insertRowsAfter(this.sheet.getMaxRows(), missing);
    const target = this.sheet.getRange(first, 1, padded.length, width);
    // S-15 QA: new rows must carry the same dropdowns as the rest of the tab (the State column's
    // data validation), so copy only the validation of row 2 onto them. (G1 live check: the State
    // dropdown appears on a freshly booked Claims row.) Skipped on a tab with no data row to copy.
    if (first > 2) {
      this.sheet.getRange(2, 1, 1, width).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }
    target.setValues(padded);
  }
  /** Whole tab, not just the data range. Notes only: Apps Script has no API for threaded comments. */
  private fullRange(): GoogleAppsScript.Spreadsheet.Range {
    return this.sheet.getRange(1, 1, this.sheet.getMaxRows(), this.sheet.getMaxColumns());
  }
  setNote(row: number, col: number, text: string): void {
    const range = this.sheet.getRange(row, col);
    if (text === "") range.clearNote();
    else range.setNote(text);
  }
  getNote(row: number, col: number): string | null {
    return this.sheet.getRange(row, col).getNote() || null;
  }
  getNotes(col: number): (string | null)[] {
    const rows = this.sheet.getLastRow();
    if (rows === 0) return [];
    // One call for the whole column; Sheets gives "" for no note, which the interface calls null.
    return this.sheet.getRange(1, col, rows, 1).getNotes().map((r) => r[0] || null);
  }
  getComments(): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = [];
    this.fullRange().getNotes().forEach((r, i) =>
      r.forEach((n, j) => {
        if (n) out.push({ row: i + 1, col: j + 1 });
      }),
    );
    return out;
  }
  clearComments(): number {
    const n = this.getComments().length;
    if (n > 0) this.fullRange().clearNote();
    return n;
  }
  setDataValidation(col: number, allowed: string[]): void {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(allowed, true).setAllowInvalid(false).build();
    const rows = Math.max(this.sheet.getMaxRows() - 1, 1);
    this.sheet.getRange(2, col, rows, 1).setDataValidation(rule);
  }
  getDataValidation(col: number): string[] | null {
    const rule = this.sheet.getRange(2, col).getDataValidation();
    if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return null;
    return rule.getCriteriaValues()[0] as string[];
  }
  setFormula(row: number, col: number, formula: string): void {
    this.sheet.getRange(row, col).setFormula(formula);
  }
  getFormulas(): { row: number; col: number; formula: string }[] {
    const out: { row: number; col: number; formula: string }[] = [];
    if (this.sheet.getLastRow() === 0) return out;
    this.sheet.getDataRange().getFormulas().forEach((r, i) =>
      r.forEach((f, j) => {
        if (f) out.push({ row: i + 1, col: j + 1, formula: f });
      }),
    );
    return out;
  }
  getLinks(): { row: number; col: number; url: string }[] {
    const out: { row: number; col: number; url: string }[] = [];
    if (this.sheet.getLastRow() === 0 || this.sheet.getLastColumn() === 0) return out;
    this.sheet.getDataRange().getRichTextValues().forEach((r, i) =>
      r.forEach((rt, j) => {
        // Whole-cell link, or any link run inside the text.
        if (!rt) return;
        const urls = [rt.getLinkUrl(), ...rt.getRuns().map((run) => run.getLinkUrl())].filter((u): u is string => !!u);
        if (urls.length > 0) out.push({ row: i + 1, col: j + 1, url: urls.join(" ") });
      }),
    );
    return out;
  }
  setLink(row: number, col: number, url: string | null): void {
    const range = this.sheet.getRange(row, col);
    const text = range.getDisplayValue();
    const rich = SpreadsheetApp.newRichTextValue().setText(text);
    if (url !== null) rich.setLinkUrl(url);
    range.setRichTextValue(rich.build());
  }
}

class ActiveSpreadsheet implements Spreadsheet {
  constructor(private readonly ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {}

  getTitle(): string {
    return this.ss.getName();
  }
  getTabs(): Tab[] {
    return this.ss.getSheets().map((s) => new SheetTab(s));
  }
  getTab(name: string): Tab | undefined {
    const s = this.ss.getSheetByName(name);
    return s ? new SheetTab(s) : undefined;
  }
  flush(): void {
    SpreadsheetApp.flush();
  }
  addTab(name: string): Tab {
    return new SheetTab(this.ss.insertSheet(name));
  }
}

export function activeSpreadsheet(): Spreadsheet {
  return new ActiveSpreadsheet(SpreadsheetApp.getActive());
}
