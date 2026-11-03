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
  /** Notes only. Apps Script has no API for threaded comments (see scrubStaging docs). */
  getComments(): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = [];
    if (this.sheet.getLastRow() === 0) return out;
    this.sheet.getDataRange().getNotes().forEach((r, i) =>
      r.forEach((n, j) => {
        if (n) out.push({ row: i + 1, col: j + 1 });
      }),
    );
    return out;
  }
  clearComments(): number {
    const n = this.getComments().length;
    if (n > 0) this.sheet.getDataRange().clearNote();
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
    throw new Error("not implemented");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setLink(_row: number, _col: number, _url: string | null): void {
    throw new Error("not implemented");
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
  addTab(name: string): Tab {
    return new SheetTab(this.ss.insertSheet(name));
  }
}

export function activeSpreadsheet(): Spreadsheet {
  return new ActiveSpreadsheet(SpreadsheetApp.getActive());
}
