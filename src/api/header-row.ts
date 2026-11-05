// D-027: where the header row of an item tab (or Template) is.
//
// The seller's real tabs have a title in row 1 and the column names in row 2,
// so "row 1 is the header" is wrong. Following the rule "find columns by header
// name, never by position" (brief 4.1), we find the row the same way: it is the
// first of the top rows that has a cell reading exactly "Person". Rows above it
// are titles or notes, never data. Shared so every story reads item tabs alike.
import type { CellValue } from "./sheet";

/** How many rows from the top are searched for the header. */
export const HEADER_SEARCH_ROWS = 5;

/** 0-based index of the header row, or -1 when none of the top rows has a "Person" cell. */
export function findHeaderRow(grid: CellValue[][]): number {
  return grid
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((row) => row.some((c) => typeof c === "string" && c.trim() === "Person"));
}
