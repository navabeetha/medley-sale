/* eslint-disable @typescript-eslint/no-unused-vars */
// S-03 stubs. Real logic is the implementer's job (green step).
import type { Spreadsheet } from "./sheet";

export interface ScrubOptions {
  /** Optional sink for progress lines. Must only ever receive counts. */
  log?: (line: string) => void;
}

/** Counts only. Never original values. */
export interface ScrubResult {
  peopleReplaced: number;
  /** Cells (README and header rows) from which a phone number was removed. */
  numbersRemoved: number;
  commentsRemoved: number;
}

export interface MigrateOptions {
  /** Cryptographic random source: returns n random bytes. */
  randomBytes: (n: number) => Uint8Array;
  /** ISO timestamp used for `Created`. */
  now: () => string;
  log?: (line: string) => void;
}

/** Counts of changes made by this run. All zero on a rerun. */
export interface MigrateResult {
  columnsAdded: number;
  tabsCreated: number;
  idsAssigned: number;
  quantitiesSet: number;
  bookingsCreated: number;
  claimsCreated: number;
}

export function scrubStaging(_ss: Spreadsheet, _opts?: ScrubOptions): ScrubResult {
  throw new Error("not implemented");
}

export function migrate(_ss: Spreadsheet, _opts: MigrateOptions): MigrateResult {
  throw new Error("not implemented");
}
