// In-memory fake of the sheet layer (src/api/sheet.ts). Synthetic data only.
import type { CellValue, Spreadsheet, Tab } from "../../src/api/sheet";

export class FakeTab implements Tab {
  grid: CellValue[][] = [];
  comments: { row: number; col: number }[] = [];
  validations = new Map<number, string[]>();
  formulas: { row: number; col: number; formula: string }[] = [];
  /** Every string written through setCell/appendRow, for the 6.3 guard checks. */
  writtenStrings: string[] = [];

  constructor(readonly name: string) {}

  getGrid(): CellValue[][] {
    return this.grid.map((r) => [...r]);
  }
  setCell(row: number, col: number, value: CellValue): void {
    if (row < 1 || col < 1) throw new Error("cells are 1-based");
    while (this.grid.length < row) this.grid.push([]);
    const r = this.grid[row - 1]!;
    while (r.length < col) r.push(null);
    r[col - 1] = value;
    if (typeof value === "string") this.writtenStrings.push(value);
  }
  appendRow(values: CellValue[]): void {
    this.grid.push([...values]);
    for (const v of values) if (typeof v === "string") this.writtenStrings.push(v);
  }
  getComments() {
    return this.comments.map((c) => ({ ...c }));
  }
  clearComments(): number {
    const n = this.comments.length;
    this.comments = [];
    return n;
  }
  setDataValidation(col: number, allowed: string[]): void {
    this.validations.set(col, [...allowed]);
  }
  getDataValidation(col: number): string[] | null {
    return this.validations.get(col) ?? null;
  }
  setFormula(row: number, col: number, formula: string): void {
    this.formulas = this.formulas.filter((f) => !(f.row === row && f.col === col));
    this.formulas.push({ row, col, formula });
  }
  getFormulas() {
    return this.formulas.map((f) => ({ ...f }));
  }
}

export class FakeSpreadsheet implements Spreadsheet {
  tabs: FakeTab[] = [];
  constructor(private title: string) {}

  getTitle(): string {
    return this.title;
  }
  getTabs(): Tab[] {
    return [...this.tabs];
  }
  getTab(name: string): Tab | undefined {
    return this.tabs.find((t) => t.name === name);
  }
  addTab(name: string): Tab {
    if (this.getTab(name)) throw new Error(`tab exists: ${name}`);
    const t = new FakeTab(name);
    this.tabs.push(t);
    return t;
  }
  /** Fixture helper: add a tab holding the given rows (header row first). */
  withTab(name: string, rows: CellValue[][]): FakeTab {
    const t = this.addTab(name) as FakeTab;
    t.grid = rows.map((r) => [...r]);
    t.writtenStrings = [];
    return t;
  }
  /** Whole observable state, for "nothing changed" comparisons. */
  snapshot(): string {
    return JSON.stringify({
      title: this.title,
      tabs: this.tabs.map((t) => ({
        name: t.name,
        grid: t.grid,
        comments: t.comments,
        validations: [...t.validations.entries()],
        formulas: t.formulas,
      })),
    });
  }
}

/** Deterministic byte source: a counter, so each call differs. */
export function counterRandom(seed = 0) {
  let n = seed;
  const requested: number[] = [];
  const fn = (len: number): Uint8Array => {
    requested.push(len);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = (n++ * 37 + 11) & 0xff;
    return out;
  };
  return { fn, requested };
}
