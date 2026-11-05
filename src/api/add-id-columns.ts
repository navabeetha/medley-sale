// R1 / D-035 rule 3: addIdColumns(), the editor function that prepares the REAL
// sheet for the browse-only release. It adds "ID" and "Quantity" columns to the
// four item tabs, fills IDs and quantities, and nothing else: no new tabs, no
// guard on the file title (unlike migrate, this is meant for the real sheet),
// and the Person column is never read or written. Safe to run again.
// Logs and results carry counts only: no names, numbers or tokens.
import { ITEM_TABS } from "./catalogue";
import { findHeaderRow } from "./header-row";
import { colOf, ensureIdQuantityHeaders, idAllocator, isBlank, itemNameCol } from "./migrate";
import type { CellValue, Spreadsheet, Tab } from "./sheet";

export interface AddIdColumnsOptions {
  /** Optional sink for progress lines. Must only ever receive counts. */
  log?: (line: string) => void;
}

/** Counts of changes made by this run. All zero on a rerun. */
export interface AddIdColumnsResult {
  columnsAdded: number;
  idsAssigned: number;
  quantitiesSet: number;
}

/** Header row index of a tab, or a thrown error when the tab cannot be set up. */
function checkTab(tab: Tab | undefined, name: string): { tab: Tab; hr: number } {
  if (!tab) throw new Error(`Tab "${name}" is missing`);
  const grid = tab.getGrid();
  const hr = findHeaderRow(grid);
  if (hr < 0) throw new Error(`Tab "${name}" has no header row`);
  if (!itemNameCol(tab, grid[hr]!)) throw new Error(`Tab "${name}" has no item name column`);
  return { tab, hr };
}

export function addIdColumns(ss: Spreadsheet, opts: AddIdColumnsOptions = {}): AddIdColumnsResult {
  const result: AddIdColumnsResult = { columnsAdded: 0, idsAssigned: 0, quantitiesSet: 0 };

  // 0. Check all four tabs before writing anything, so a bad tab never leaves
  // the others half-numbered. Tab order is the sheet's, as in migrate.
  const names = new Set(ITEM_TABS);
  for (const n of ITEM_TABS) checkTab(ss.getTab(n), n);
  const tabs = ss.getTabs().filter((t) => names.has(t.name));

  // 1. Headers at the far right of each header row.
  for (const tab of tabs) {
    const grid = tab.getGrid();
    const hr = findHeaderRow(grid);
    result.columnsAdded += ensureIdQuantityHeaders(tab, hr, grid[hr]!);
  }

  // 2. IDs in tab then row order. Every ID already on any row counts as used.
  const used = new Set<string>();
  for (const tab of tabs) {
    const grid = tab.getGrid();
    const hr = findHeaderRow(grid);
    const idCol = colOf(grid[hr]!, "ID");
    for (const r of grid.slice(hr + 1)) if (!isBlank(r[idCol - 1])) used.add(String(r[idCol - 1]));
  }
  const newId = idAllocator(used);
  for (const tab of tabs) {
    const grid = tab.getGrid();
    const hr = findHeaderRow(grid);
    const head = grid[hr]!;
    const idCol = colOf(head, "ID");
    const qtyCol = colOf(head, "Quantity");
    const skip = [idCol, qtyCol];
    for (let r = hr + 1; r < grid.length; r++) {
      const cells: CellValue[] = grid[r]!;
      // A row with nothing but (maybe) an ID or quantity is empty: leave it alone.
      if (cells.every((v, i) => isBlank(v) || skip.includes(i + 1))) continue;
      if (isBlank(cells[idCol - 1])) {
        tab.setCell(r + 1, idCol, newId());
        result.idsAssigned++;
      }
      if (isBlank(cells[qtyCol - 1])) {
        tab.setCell(r + 1, qtyCol, 1);
        result.quantitiesSet++;
      }
    }
  }

  opts.log?.(
    `addIdColumns: ${result.columnsAdded} columns added, ${result.idsAssigned} IDs assigned, ` +
      `${result.quantitiesSet} quantities set`,
  );
  return result;
}
